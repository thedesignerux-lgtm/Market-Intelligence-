-- 0001 · Extensiones y utilidades de texto
-- PostGIS (geografía), pg_trgm (búsqueda tolerante a errores) y unaccent (ignorar acentos).
-- En Supabase las extensiones viven en el esquema "extensions".

create schema if not exists extensions;
create extension if not exists postgis  with schema extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- unaccent no es IMMUTABLE, así que no se puede usar en índices ni columnas generadas.
-- Este envoltorio fija el diccionario y sí lo es.
create or replace function public.immutable_unaccent(input text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, input)
$$;

-- Normalización básica para búsqueda: minúsculas, sin acentos, solo letras/números, espacios simples.
-- La normalización "fuerte" (quitar formas jurídicas, palabras vacías) se hace en la aplicación
-- y se guarda en entities.normalized_name.
create or replace function public.search_normalize(input text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select btrim(regexp_replace(lower(public.immutable_unaccent(input)), '[^a-z0-9ñ]+', ' ', 'g'))
$$;

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
