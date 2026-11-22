-- Clubes de Castilla y León desde el Registro de Clubes Deportivos de la Junta (datos abiertos, CC BY 4.0).
-- Licencia comprobada el 22/11/2026 en datos.gob.es (a07002862). Actualización diaria de lunes a viernes.

insert into public.sources (id, name, kind, license, license_url, attribution, homepage, default_confidence) values
  ('registro_castilla_leon', 'Registro de Clubes Deportivos de Castilla y León (Junta de Castilla y León)', 'open_data',
   'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
   'Junta de Castilla y León · Datos abiertos', 'https://datosabiertos.jcyl.es/web/jcyl/set/es/deporte/clubes-deportivos/1284839616146', 0.85)
on conflict (id) do nothing;

insert into public.category_mappings (source_id, match, category_id, entity_type, priority)
select 'registro_castilla_leon', '{"modalidad": "CICLISMO"}'::jsonb, 'club.deportivo.ciclismo', 'club', 200
 where not exists (select 1 from public.category_mappings m
                    where m.source_id = 'registro_castilla_leon' and m.match = '{"modalidad": "CICLISMO"}'::jsonb);
