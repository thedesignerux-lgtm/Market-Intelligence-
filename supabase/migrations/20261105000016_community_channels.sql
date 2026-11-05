-- Comunidades online (Telegram / WhatsApp) como canales de difusión para GROPO.
-- Cambios aditivos: no modifica ni borra datos existentes.

-- 1. Categorías para comunidades
insert into public.categories (id, name, parent_id, entity_type, sort) values
  ('comunidad',          'Comunidad online',   null,        'comunidad', 50),
  ('comunidad.ciclismo', 'Comunidad ciclista', 'comunidad', 'comunidad', 51)
on conflict (id) do nothing;

-- 2. Contactos de Telegram y WhatsApp
alter table public.contact_points drop constraint contact_points_kind_check;
alter table public.contact_points add constraint contact_points_kind_check
  check (kind = any (array['phone', 'email', 'website', 'telegram', 'whatsapp']));

-- 3. Identificadores de plataforma (clave para no duplicar comunidades)
alter table public.entity_identifiers drop constraint entity_identifiers_scheme_check;
alter table public.entity_identifiers add constraint entity_identifiers_scheme_check
  check (scheme = any (array['nif', 'red_galicia', 'osm', 'wikidata', 'registro',
                             'telegram', 'whatsapp_channel', 'whatsapp_group', 'strava_club']));

-- 4. Fuente propia para la investigación de comunidades
alter table public.sources drop constraint sources_kind_check;
alter table public.sources add constraint sources_kind_check
  check (kind = any (array['osm', 'open_data', 'geocoder', 'manual', 'file', 'web']));

insert into public.sources (id, name, kind, license, attribution, default_confidence)
values ('investigacion_comunidades',
        'Investigación de comunidades (páginas públicas)',
        'web',
        'Datos públicos consultados; sin licencia de reutilización',
        'Telegram (t.me), canales de WhatsApp, Strava y directorios públicos',
        0.70)
on conflict (id) do nothing;

-- 5. Rol «canal de difusión»
alter table public.entity_roles add column channel_potential boolean;
comment on column public.entity_roles.channel_potential is
  'Puede difundir campañas de GROPO entre sus miembros. NULL = valor por defecto según el tipo de entidad.';

create or replace function public.default_channel(t public.entity_type)
returns boolean language sql immutable set search_path = '' as $$
  select t = 'comunidad'
$$;

create or replace view public.entity_effective_roles with (security_invoker = true) as
 select w.id as workspace_id,
    e.id as entity_id,
    coalesce(r.buyer_potential, public.default_buyer(e.entity_type)) as buyer_potential,
    coalesce(r.seller_potential, public.default_seller(e.entity_type)) as seller_potential,
    coalesce(r.buyer_participant, false) as buyer_participant,
    coalesce(r.seller_participant, false) as seller_participant,
    r.buyer_evidence,
    r.buyer_verified_at,
    r.buyer_verified_by,
    r.seller_evidence,
    r.seller_verified_at,
    r.seller_verified_by,
    r.entity_id is not null as is_manual,
    coalesce(r.channel_potential, public.default_channel(e.entity_type)) as channel_potential
   from public.workspaces w
     cross join public.entities e
     left join public.entity_roles r on r.workspace_id = w.id and r.entity_id = e.id
  where e.merged_into is null;

create or replace function public.set_entity_channel(p_workspace uuid, p_entity uuid, p_channel_potential boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cur record;
begin
  if not public.has_role(p_workspace, array['admin', 'editor', 'comercial']::public.app_role[]) then
    raise exception 'Permiso denegado: tu rol no permite cambiar la clasificación' using errcode = '42501';
  end if;

  select * into cur from public.entity_effective_roles where workspace_id = p_workspace and entity_id = p_entity;
  if not found then
    raise exception 'La entidad no existe o está fusionada' using errcode = 'P0002';
  end if;

  insert into public.entity_roles as r (workspace_id, entity_id, buyer_potential, seller_potential,
                                        channel_potential, updated_at, updated_by)
  values (p_workspace, p_entity, cur.buyer_potential, cur.seller_potential,
          p_channel_potential, now(), auth.uid())
  on conflict (workspace_id, entity_id) do update set
    channel_potential = excluded.channel_potential,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  insert into public.crm_events (workspace_id, entity_id, actor_id, kind, from_value, to_value)
  values (p_workspace, p_entity, auth.uid(), 'roles_changed',
          jsonb_build_object('channel_potential', cur.channel_potential),
          jsonb_build_object('channel_potential', coalesce(p_channel_potential, public.default_channel(
            (select entity_type from public.entities where id = p_entity)))));
end;
$$;
revoke all on function public.set_entity_channel(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_entity_channel(uuid, uuid, boolean) to authenticated;

-- Filtro de rol «canal_potencial» en búsqueda y mapa (se parchea la definición actual)
do $mig$
declare
  d text;
  n text;
begin
  select pg_get_functiondef('public.search_entities(uuid, text, public.entity_type[], text, text, text, integer, real, text, uuid, text, smallint, text, text)'::regprocedure) into d;
  n := replace(d,
    'coalesce(r.seller_participant, false) as r_spart,',
    'coalesce(r.seller_participant, false) as r_spart,
           coalesce(r.channel_potential, public.default_channel(e.entity_type)) as r_cp,');
  n := replace(n,
    'when ''sin_rol''                then not (b.r_bp or b.r_sp or b.r_bpart or b.r_spart)',
    'when ''canal_potencial''        then b.r_cp
             when ''sin_rol''                then not (b.r_bp or b.r_sp or b.r_bpart or b.r_spart or b.r_cp)');
  if n = d or position('r_cp,' in n) = 0 or position('canal_potencial' in n) = 0 then
    raise exception 'search_entities no tiene la forma esperada; migración cancelada';
  end if;
  execute n;

  select pg_get_functiondef('public.map_features(uuid, double precision, double precision, double precision, double precision, integer, public.entity_type[], text, text, integer, text)'::regprocedure) into d;
  n := regexp_replace(d,
    '(when ''vendedor_participante''\s+then coalesce\(r\.seller_participant, false\))',
    E'\\1\n             when ''canal_potencial''        then coalesce(r.channel_potential, public.default_channel(e.entity_type))');
  if n = d then
    raise exception 'map_features no tiene la forma esperada; migración cancelada';
  end if;
  execute n;
end
$mig$;

-- 6. Relaciones entre entidades (red → canales, asociación → grupo, club → grupo)
create table public.entity_relations (
  id bigint generated always as identity primary key,
  parent_id uuid not null references public.entities(id) on delete cascade,
  child_id uuid not null references public.entities(id) on delete cascade,
  relation text not null check (relation in ('pertenece_a', 'gestionada_por', 'canal_de')),
  evidence text check (evidence is null or char_length(btrim(evidence)) between 3 and 500),
  source_id text references public.sources(id),
  source_url text,
  observed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (parent_id <> child_id),
  unique (parent_id, child_id, relation)
);
comment on table public.entity_relations is
  'Relaciones entre entidades. child_id <relation> parent_id: p. ej. un canal «pertenece_a» una red o «gestionada_por» una asociación.';
create index entity_relations_child_idx on public.entity_relations (child_id);

alter table public.entity_relations enable row level security;
create policy entity_relations_read_members on public.entity_relations for select to authenticated
  using (public.has_role_anywhere(array['admin', 'editor', 'comercial', 'lector']::public.app_role[]));
create policy entity_relations_insert_curators on public.entity_relations for insert to authenticated
  with check (public.has_role_anywhere(array['admin', 'editor']::public.app_role[]));
create policy entity_relations_delete_curators on public.entity_relations for delete to authenticated
  using (public.has_role_anywhere(array['admin', 'editor']::public.app_role[]));
revoke all on public.entity_relations from anon;
grant select, insert, delete on public.entity_relations to authenticated;

-- Vista que resuelve entidades fusionadas hacia la superviviente
create view public.entity_relations_effective with (security_invoker = true) as
select r.id,
       coalesce(p.merged_into, r.parent_id) as parent_id,
       coalesce(c.merged_into, r.child_id)  as child_id,
       r.relation, r.evidence, r.source_id, r.source_url, r.observed_at, r.created_by, r.created_at
from public.entity_relations r
join public.entities p on p.id = r.parent_id
join public.entities c on c.id = r.child_id;
revoke all on public.entity_relations_effective from anon;
grant select on public.entity_relations_effective to authenticated;
