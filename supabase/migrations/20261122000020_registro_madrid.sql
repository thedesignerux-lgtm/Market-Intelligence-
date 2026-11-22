-- Clubes de ciclismo de Madrid desde el Registro de Entidades Deportivas de la Comunidad de Madrid.
-- Datos abiertos, CC BY 4.0 (comprobado el 22/11/2026 en datos.comunidad.madrid, dataset
-- spacm_entidades_deportivas: license_id cc-by).
-- Aviso de calidad: el fichero NO publica la modalidad deportiva, solo tipo de entidad, número,
-- denominación y municipio. El ciclismo se deduce de la denominación, así que faltan los clubes
-- multideporte cuyo nombre no lo menciona y puede colarse algún falso positivo. Por eso la
-- confianza por omisión es menor que en los registros que sí publican la modalidad, y cada ficha
-- guarda modalidad_inferida = true en su payload.

insert into public.sources (id, name, kind, license, license_url, attribution, homepage, default_confidence) values
  ('registro_madrid', 'Registro de Entidades Deportivas de la Comunidad de Madrid', 'open_data',
   'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
   'Comunidad de Madrid · Datos abiertos',
   'https://datos.comunidad.madrid/dataset/registro-de-entidades-deportivas-de-la-comunidad-de-madrid',
   0.6)
on conflict (id) do nothing;

insert into public.category_mappings (source_id, match, category_id, entity_type, priority)
select 'registro_madrid', '{"modalidad": "CICLISMO"}'::jsonb, 'club.deportivo.ciclismo', 'club', 200
 where not exists (select 1 from public.category_mappings m
                    where m.source_id = 'registro_madrid' and m.match = '{"modalidad": "CICLISMO"}'::jsonb);
