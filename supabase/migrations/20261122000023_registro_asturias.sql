-- Clubes de ciclismo de Asturias desde la Guía de clubes del portal Deporte Asturiano.
-- Asturias no publica el registro como fichero ni tiene buscador público, pero la guía es una
-- página con las tablas completas: denominación, dirección, CP, localidad, municipio, correo y
-- modalidades. La modalidad la publica la guía, no se deduce del nombre.
-- La guía no trae número de registro: el identificador externo se compone del nombre y el CP.
-- No declara licencia: se aplican las condiciones generales de reutilización de la información
-- del sector público (Ley 37/2007 y RD 1495/2011), citando la fuente. Comprobado el 22/11/2026.

insert into public.sources (id, name, kind, license, license_url, attribution, homepage, default_confidence) values
  ('registro_asturias', 'Guía de clubes del Principado de Asturias', 'open_data',
   'Reutilización RD 1495/2011 (citar la fuente)', 'https://www.boe.es/eli/es/rd/2011/10/24/1495/con',
   'Gobierno del Principado de Asturias · Deporte Asturiano',
   'https://deporte.asturias.es/guia-de-clubes', 0.85)
on conflict (id) do nothing;

insert into public.category_mappings (source_id, match, category_id, entity_type, priority)
select 'registro_asturias', '{"modalidad": "CICLISMO"}'::jsonb, 'club.deportivo.ciclismo', 'club', 200
 where not exists (select 1 from public.category_mappings m
                    where m.source_id = 'registro_asturias' and m.match = '{"modalidad": "CICLISMO"}'::jsonb);
