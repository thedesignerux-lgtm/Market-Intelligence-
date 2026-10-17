-- 0004 · Entidades (ficha consolidada) y procedencia de los datos
--
-- Principio (ADR-0004): lo que dice cada fuente se guarda intacto en source_records.
-- La ficha (entities) es una vista consolidada que se recalcula a partir de field_values,
-- eligiendo el mejor valor de cada campo. Así nunca perdemos el origen de un dato ni
-- sobrescribimos un dato verificado con otro peor.

create type public.location_precision as enum ('exact', 'address', 'street', 'postal_code', 'municipality', 'unknown');
create type public.entity_status as enum ('active', 'closed', 'unverified');
create type public.value_method as enum ('found', 'verified', 'inferred', 'manual');

create table public.entities (
  id                  uuid primary key default gen_random_uuid(),
  entity_type         public.entity_type not null,
  name                text not null check (char_length(name) between 1 and 300),
  -- Nombre normalizado por la aplicación (sin acentos, sin formas jurídicas ni palabras vacías).
  normalized_name     text not null,
  category_id         text references public.categories(id),
  geom                extensions.geometry(Point, 4326),
  location_precision  public.location_precision not null default 'unknown',
  address             text,
  -- true si la dirección parece un domicilio particular (piso/puerta): se trata como dato personal.
  address_is_personal boolean not null default false,
  postal_code         text check (postal_code ~ '^[0-9]{5}$'),
  municipality_code   text references public.admin_areas(code),
  status              public.entity_status not null default 'active',
  -- Si se fusionó con otra entidad, apunta a la superviviente (fusión reversible).
  merged_into         uuid references public.entities(id),
  search_text         text generated always as (public.search_normalize(coalesce(name, '') || ' ' || coalesce(address, ''))) stored,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index entities_geom_idx         on public.entities using gist (geom);
create index entities_search_trgm_idx  on public.entities using gin (search_text extensions.gin_trgm_ops);
create index entities_norm_trgm_idx    on public.entities using gin (normalized_name extensions.gin_trgm_ops);
create index entities_muni_type_idx    on public.entities (municipality_code, entity_type) where merged_into is null;
create index entities_category_idx     on public.entities (category_id) where merged_into is null;
create index entities_name_order_idx   on public.entities (normalized_name, id) where merged_into is null;
create trigger entities_updated_at before update on public.entities
  for each row execute function public.set_updated_at();

-- Una entidad puede tener varias categorías (p. ej. un club multideporte).
create table public.entity_categories (
  entity_id    uuid not null references public.entities(id) on delete cascade,
  category_id  text not null references public.categories(id),
  source_id    text not null references public.sources(id),
  primary key (entity_id, category_id, source_id)
);
create index entity_categories_category_idx on public.entity_categories (category_id);

-- Registro original tal y como lo publica la fuente. Nunca se edita a mano.
create table public.source_records (
  id               uuid primary key default gen_random_uuid(),
  source_id        text not null references public.sources(id),
  -- Identificador estable en la fuente: "node/123" en OSM, número de inscripción en el RED.
  external_id      text not null,
  payload          jsonb not null,
  payload_hash     text not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_changed_at  timestamptz not null default now(),
  -- Si deja de aparecer en la fuente, se marca (no se borra).
  missing_since    timestamptz,
  last_import_run  uuid,
  unique (source_id, external_id)
);
create index source_records_run_idx on public.source_records (last_import_run);

-- Qué registros de origen alimentan cada entidad. Un registro pertenece a una sola entidad.
create table public.entity_sources (
  source_record_id uuid primary key references public.source_records(id) on delete cascade,
  entity_id        uuid not null references public.entities(id) on delete cascade,
  link_method      text not null check (link_method in ('created', 'auto_match', 'manual_match', 'merge')),
  confidence       numeric(4,3) not null check (confidence between 0 and 1),
  linked_at        timestamptz not null default now(),
  linked_by        uuid references auth.users(id)
);
create index entity_sources_entity_idx on public.entity_sources (entity_id);

-- Identificadores oficiales o de fuentes (NIF, nº de inscripción, id OSM).
create table public.entity_identifiers (
  entity_id        uuid not null references public.entities(id) on delete cascade,
  scheme           text not null check (scheme in ('nif', 'red_galicia', 'osm', 'wikidata')),
  value            text not null,
  source_record_id uuid references public.source_records(id) on delete cascade,
  primary key (entity_id, scheme, value)
);
create index entity_identifiers_lookup_idx on public.entity_identifiers (scheme, value);

-- Valor de cada campo según cada fuente, con su procedencia (procedencia por campo).
create table public.field_values (
  id               bigint generated always as identity primary key,
  entity_id        uuid not null references public.entities(id) on delete cascade,
  field            text not null check (field in ('name', 'address', 'postal_code', 'location', 'municipality_code', 'phone', 'website', 'email', 'opening_hours')),
  value            jsonb not null,
  source_id        text not null references public.sources(id),
  source_record_id uuid references public.source_records(id) on delete set null,
  source_url       text,
  method           public.value_method not null,
  confidence       numeric(3,2) not null check (confidence between 0 and 1),
  observed_at      timestamptz not null default now(),
  is_selected      boolean not null default false,
  created_at       timestamptz not null default now(),
  unique nulls not distinct (entity_id, field, source_id, source_record_id)
);
create index field_values_entity_idx on public.field_values (entity_id, field);

-- Puntos de contacto consolidados (para buscar y deduplicar por teléfono/dominio).
create table public.contact_points (
  id               bigint generated always as identity primary key,
  entity_id        uuid not null references public.entities(id) on delete cascade,
  kind             text not null check (kind in ('phone', 'email', 'website')),
  value            text not null,
  -- Teléfono en E.164 (+34...), email en minúsculas, web reducida a dominio.
  normalized       text not null,
  -- Heurística: móviles y emails nominales de clubes suelen ser de personas físicas (RGPD).
  is_personal_data boolean not null default false,
  source_id        text not null references public.sources(id),
  source_record_id uuid references public.source_records(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (entity_id, kind, normalized)
);
create index contact_points_lookup_idx on public.contact_points (kind, normalized);

-- Caché de geocodificación (CartoCiudad permite reutilizar resultados con atribución, CC BY 4.0).
create table public.geocode_cache (
  query_key    text primary key,
  provider     text not null references public.sources(id),
  result       jsonb,
  created_at   timestamptz not null default now()
);

-- Recalcula la ficha a partir de field_values.
-- Prioridad: manual > verificado > encontrado > inferido; después confianza; después lo más reciente.
create or replace function public.refresh_entity(p_entity_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v record;
begin
  update public.field_values set is_selected = false where entity_id = p_entity_id and is_selected;

  update public.field_values fv set is_selected = true
  from (
    select distinct on (field) id
    from public.field_values
    where entity_id = p_entity_id
    order by field,
             case method when 'manual' then 4 when 'verified' then 3 when 'found' then 2 else 1 end desc,
             confidence desc,
             observed_at desc,
             id desc
  ) best
  where fv.id = best.id;

  for v in select field, value from public.field_values where entity_id = p_entity_id and is_selected loop
    if v.field = 'name' then
      update public.entities set name = v.value #>> '{}' where id = p_entity_id;
    elsif v.field = 'address' then
      update public.entities
        set address = v.value ->> 'text',
            address_is_personal = coalesce((v.value ->> 'is_personal')::boolean, false)
        where id = p_entity_id;
    elsif v.field = 'postal_code' then
      update public.entities set postal_code = v.value #>> '{}' where id = p_entity_id;
    elsif v.field = 'municipality_code' then
      update public.entities set municipality_code = v.value #>> '{}' where id = p_entity_id;
    elsif v.field = 'location' then
      update public.entities
        set geom = extensions.st_setsrid(extensions.st_makepoint((v.value ->> 'lon')::float8, (v.value ->> 'lat')::float8), 4326),
            location_precision = (v.value ->> 'precision')::public.location_precision
        where id = p_entity_id;
    end if;
  end loop;

  update public.entities e set
    last_seen_at = coalesce((
      select max(sr.last_seen_at) from public.entity_sources es
      join public.source_records sr on sr.id = es.source_record_id
      where es.entity_id = e.id), e.last_seen_at),
    -- Si todas sus fuentes han dejado de publicarla, pasa a "sin verificar" (nunca se borra).
    status = case
      when e.status = 'closed' then 'closed'
      when exists (select 1 from public.entity_sources es join public.source_records sr on sr.id = es.source_record_id
                   where es.entity_id = e.id and sr.missing_since is null) then 'active'
      when exists (select 1 from public.entity_sources es where es.entity_id = e.id) then 'unverified'
      else e.status end
  where e.id = p_entity_id;
end;
$$;
