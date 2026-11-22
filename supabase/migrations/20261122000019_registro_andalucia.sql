-- Clubes de ciclismo de Andalucía desde el Registro Andaluz de Entidades Deportivas (RAED).
-- El RAED es un registro público consultable por cualquier persona; la Junta no publica el
-- conjunto en su portal de datos abiertos, así que la fuente es el propio buscador oficial.
-- La página del registro no declara una licencia concreta: se aplican las condiciones
-- generales de reutilización de la información del sector público (Ley 37/2007 y
-- RD 1495/2011), que obligan a citar la fuente y a no desnaturalizar la información.
-- Comprobado el 22/11/2026.

insert into public.sources (id, name, kind, license, license_url, attribution, homepage, default_confidence) values
  ('registro_andalucia', 'Registro Andaluz de Entidades Deportivas (Junta de Andalucía)', 'open_data',
   'Reutilización RD 1495/2011 (citar la fuente)', 'https://www.boe.es/eli/es/rd/2011/10/24/1495/con',
   'Junta de Andalucía · Registro Andaluz de Entidades Deportivas (RAED)',
   'https://www.juntadeandalucia.es/organismos/culturaydeporte/areas/deporte/entidades-deportivas/registro-entidades-deportivas.html',
   0.9)
on conflict (id) do nothing;

insert into public.category_mappings (source_id, match, category_id, entity_type, priority)
select 'registro_andalucia', '{"modalidad": "CICLISMO"}'::jsonb, 'club.deportivo.ciclismo', 'club', 200
 where not exists (select 1 from public.category_mappings m
                    where m.source_id = 'registro_andalucia' and m.match = '{"modalidad": "CICLISMO"}'::jsonb);
