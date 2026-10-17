-- 0003 · Datos de referencia: fuentes, territorio, tipos de entidad y taxonomía

create type public.entity_type as enum ('comercio', 'distribuidor', 'club', 'asociacion', 'comunidad');

-- Fuentes de datos con su licencia. Cada dato importado apunta a una de estas filas.
create table public.sources (
  id                  text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name                text not null,
  kind                text not null check (kind in ('osm', 'open_data', 'geocoder', 'manual', 'file')),
  license             text not null,
  license_url         text,
  attribution         text not null,
  homepage            text,
  -- Confianza por defecto de los datos de esta fuente (0..1). Se puede refinar por campo.
  default_confidence  numeric(3,2) not null check (default_confidence between 0 and 1),
  created_at          timestamptz not null default now()
);

insert into public.sources (id, name, kind, license, license_url, attribution, homepage, default_confidence) values
  ('osm', 'OpenStreetMap', 'osm', 'ODbL 1.0', 'https://opendatacommons.org/licenses/odbl/1-0/',
   '© OpenStreetMap contributors', 'https://www.openstreetmap.org', 0.60),
  ('red_galicia', 'Rexistro de Entidades Deportivas de Galicia (Xunta de Galicia)', 'open_data', 'CC BY-SA 4.0',
   'https://creativecommons.org/licenses/by-sa/4.0/', 'Xunta de Galicia · Rexistro de Entidades Deportivas',
   'https://abertos.xunta.gal/catalogo/cultura-ocio-deporte/-/dataset/0271/rexistro-entidades-deportivas', 0.85),
  ('cartociudad', 'CartoCiudad (IGN / CNIG)', 'geocoder', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
   'CartoCiudad © Instituto Geográfico Nacional', 'https://www.cartociudad.es', 0.70),
  ('manual', 'Edición manual', 'manual', 'Propietaria', null, 'Equipo interno', null, 0.95);

-- Territorio: comunidad autónoma, provincia y municipio con códigos INE.
create table public.admin_areas (
  code        text primary key check (code ~ '^(ca[0-9]{2}|[0-9]{2}|[0-9]{5})$'),
  level       text not null check (level in ('ccaa', 'provincia', 'municipio')),
  name        text not null,
  parent_code text references public.admin_areas(code),
  geom        extensions.geometry(MultiPolygon, 4326),
  source_id   text references public.sources(id),
  updated_at  timestamptz not null default now()
);
create index admin_areas_geom_idx on public.admin_areas using gist (geom);
create index admin_areas_parent_idx on public.admin_areas (parent_code);

-- Códigos INE: provincia (2 dígitos), municipio (5 dígitos). Las comunidades autónomas
-- llevan prefijo "ca" (ca12 = Galicia) porque su número colisiona con el de provincias
-- (12 es también la provincia de Castellón).
insert into public.admin_areas (code, level, name, parent_code) values
  ('ca12', 'ccaa', 'Galicia', null);
insert into public.admin_areas (code, level, name, parent_code) values
  ('15', 'provincia', 'A Coruña', 'ca12'),
  ('27', 'provincia', 'Lugo', 'ca12'),
  ('32', 'provincia', 'Ourense', 'ca12'),
  ('36', 'provincia', 'Pontevedra', 'ca12');

-- Taxonomía propia. Las fuentes se traducen a ella mediante category_mappings,
-- así se añaden categorías o fuentes sin tocar código.
create table public.categories (
  id          text primary key check (id ~ '^[a-z0-9_.]{2,80}$'),
  name        text not null,
  parent_id   text references public.categories(id),
  entity_type public.entity_type,
  sort        int not null default 100
);

insert into public.categories (id, name, parent_id, entity_type, sort) values
  ('comercio.deporte',            'Tienda de deporte',          null,               'comercio', 10),
  ('comercio.deporte.ciclismo',   'Tienda de bicicletas',       'comercio.deporte', 'comercio', 11),
  ('servicio.ciclismo.taller',    'Taller de bicicletas',       null,               'comercio', 20),
  ('club.deportivo',              'Club deportivo',             null,               'club',     30),
  ('club.deportivo.ciclismo',     'Club ciclista',              'club.deportivo',   'club',     31),
  ('asociacion.federacion',       'Federación deportiva',       null,               'asociacion', 40);

-- Reglas de traducción fuente → categoría.
-- "match" se compara por contención JSON: la fila coincide si las etiquetas/atributos
-- del registro contienen todos los pares de "match".
create table public.category_mappings (
  id           bigint generated always as identity primary key,
  source_id    text not null references public.sources(id),
  match        jsonb not null check (jsonb_typeof(match) = 'object'),
  category_id  text not null references public.categories(id),
  entity_type  public.entity_type not null,
  -- Mayor prioridad = categoría principal cuando coinciden varias reglas.
  priority     int not null default 100,
  unique (source_id, match)
);

insert into public.category_mappings (source_id, match, category_id, entity_type, priority) values
  -- OpenStreetMap (etiquetas)
  ('osm', '{"shop": "bicycle"}',                              'comercio.deporte.ciclismo', 'comercio', 200),
  ('osm', '{"shop": "sports", "sport": "cycling"}',           'comercio.deporte.ciclismo', 'comercio', 190),
  ('osm', '{"service:bicycle:retail": "yes"}',                'comercio.deporte.ciclismo', 'comercio', 150),
  ('osm', '{"craft": "bicycle"}',                             'servicio.ciclismo.taller',  'comercio', 180),
  ('osm', '{"service:bicycle:repair": "yes"}',                'servicio.ciclismo.taller',  'comercio', 140),
  ('osm', '{"club": "sport", "sport": "cycling"}',            'club.deportivo.ciclismo',   'club',     200),
  -- Rexistro de Entidades Deportivas (modalidad normalizada a mayúsculas)
  ('red_galicia', '{"modalidad": "CICLISMO"}',                'club.deportivo.ciclismo',   'club',     200);
