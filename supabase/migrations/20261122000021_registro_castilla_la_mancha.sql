-- Clubes de ciclismo de Castilla-La Mancha desde el listado público del Registro de Entidades
-- Deportivas de CLM (ventanilla electrónica de la Junta), que filtra por modalidad deportiva.
-- La modalidad la publica el registro, no se deduce del nombre. El listado no trae dirección
-- ni contacto: solo número de registro, nombre, tipo, localidad y provincia.
-- El listado no declara licencia: se aplican las condiciones generales de reutilización de la
-- información del sector público (Ley 37/2007 y RD 1495/2011), citando la fuente.
-- Comprobado el 22/11/2026.

insert into public.sources (id, name, kind, license, license_url, attribution, homepage, default_confidence) values
  ('registro_castilla_la_mancha', 'Registro de Entidades Deportivas de Castilla-La Mancha', 'open_data',
   'Reutilización RD 1495/2011 (citar la fuente)', 'https://www.boe.es/eli/es/rd/2011/10/24/1495/con',
   'Junta de Comunidades de Castilla-La Mancha',
   'https://ventanillaelectronica.jccm.es/administracion_electronica/formularios/listadoRegistroEntidadesDeportivas.phtml',
   0.85)
on conflict (id) do nothing;

insert into public.category_mappings (source_id, match, category_id, entity_type, priority)
select 'registro_castilla_la_mancha', '{"modalidad": "CICLISMO"}'::jsonb, 'club.deportivo.ciclismo', 'club', 200
 where not exists (select 1 from public.category_mappings m
                    where m.source_id = 'registro_castilla_la_mancha' and m.match = '{"modalidad": "CICLISMO"}'::jsonb);
