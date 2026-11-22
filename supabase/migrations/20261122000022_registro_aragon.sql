-- Clubes de ciclismo de Aragón desde el buscador público del Registro de Entidades Deportivas
-- (SIGO, Dirección General de Deporte del Gobierno de Aragón).
-- El portal de datos abiertos de Aragón publica federaciones e instalaciones, pero no los clubes.
-- El buscador sí, filtrando por modalidad, y además trae dirección y correo de la entidad.
-- No declara licencia: se aplican las condiciones generales de reutilización de la información
-- del sector público (Ley 37/2007 y RD 1495/2011), citando la fuente. Comprobado el 22/11/2026.

insert into public.sources (id, name, kind, license, license_url, attribution, homepage, default_confidence) values
  ('registro_aragon', 'Registro de Entidades Deportivas de Aragón (Gobierno de Aragón)', 'open_data',
   'Reutilización RD 1495/2011 (citar la fuente)', 'https://www.boe.es/eli/es/rd/2011/10/24/1495/con',
   'Gobierno de Aragón · Dirección General de Deporte',
   'https://aplicaciones.aragon.es/sigodgd/entidadesPublico', 0.9)
on conflict (id) do nothing;

insert into public.category_mappings (source_id, match, category_id, entity_type, priority)
select 'registro_aragon', '{"modalidad": "CICLISMO"}'::jsonb, 'club.deportivo.ciclismo', 'club', 200
 where not exists (select 1 from public.category_mappings m
                    where m.source_id = 'registro_aragon' and m.match = '{"modalidad": "CICLISMO"}'::jsonb);
