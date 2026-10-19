-- Pruebas de seguridad (RLS) y funciones. Requiere datos importados (RED + OSM de Santiago).
-- Se ejecuta dentro de una transacción que se deshace al final: no deja rastro.
\set ON_ERROR_STOP on
begin;

-- Preparación: dos usuarios con roles distintos y un tercero sin espacio.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'comercial@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'lector@test.local'),
  ('00000000-0000-0000-0000-0000000000ff', 'ajeno@test.local');
insert into public.workspaces (id, name, slug) values ('10000000-0000-0000-0000-000000000001', 'Equipo de prueba', 'prueba');
insert into public.memberships (workspace_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'comercial'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'lector');

create temp table t_results (name text, ok boolean, detail text) on commit drop;
grant all on t_results to authenticated, anon;

create or replace function pg_temp.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into t_results values (p_name, coalesce(p_ok, false), p_detail) $$;

-- 1. Anónimo no ve nada --------------------------------------------------------
set local role anon;
do $$ begin
  begin
    perform count(*) from public.entities;
    perform pg_temp.check('anon no puede leer entidades', false, 'pudo leer');
  exception when insufficient_privilege then
    perform pg_temp.check('anon no puede leer entidades', true);
  end;
end $$;
reset role;

-- 2. Lector: lee entidades, no puede escribir CRM ------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check('lector ve entidades', (select count(*) > 0 from public.entities));
do $$ begin
  begin
    insert into public.entity_crm (workspace_id, entity_id, status_id)
    select '10000000-0000-0000-0000-000000000001', (select id from public.entities limit 1),
           (select id from public.crm_statuses where slug = 'contactado' and workspace_id = '10000000-0000-0000-0000-000000000001');
    perform pg_temp.check('lector no puede cambiar estado CRM', false, 'pudo insertar');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.check('lector no puede cambiar estado CRM', true);
  end;
end $$;
do $$ begin
  begin
    update public.entities set name = 'hackeado';
    perform pg_temp.check('lector no puede editar entidades', false, 'pudo actualizar');
  exception when insufficient_privilege then
    perform pg_temp.check('lector no puede editar entidades', true);
  end;
end $$;
do $$ begin
  begin
    perform public.merge_entities((select id from public.entities order by id limit 1), (select id from public.entities order by id desc limit 1));
    perform pg_temp.check('lector no puede fusionar', false, 'pudo fusionar');
  exception when insufficient_privilege then
    perform pg_temp.check('lector no puede fusionar', true);
  end;
end $$;
select pg_temp.check('lector no ve auditoría', (select count(*) = 0 from public.audit_log));

-- 3. Comercial: cambia estado y añade nota; queda historial ---------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into public.entity_crm (workspace_id, entity_id, status_id)
select '10000000-0000-0000-0000-000000000001', e.id, s.id
from public.entities e, public.crm_statuses s
where e.name = 'Club BTT Ultreia' and s.slug = 'contactado' and s.workspace_id = '10000000-0000-0000-0000-000000000001';
insert into public.entity_notes (workspace_id, entity_id, body)
select '10000000-0000-0000-0000-000000000001', id, 'Llamado el sábado; volver a llamar en noviembre.' from public.entities where name = 'Club BTT Ultreia';
select pg_temp.check('comercial guarda estado y nota',
  (select count(*) = 1 from public.entity_crm) and (select count(*) = 1 from public.entity_notes));
select pg_temp.check('historial CRM registrado',
  (select count(*) = 2 from public.crm_events where kind in ('status_changed', 'note_added')));
select pg_temp.check('autor de la nota es el usuario',
  (select author_id = '00000000-0000-0000-0000-00000000000c' from public.entity_notes));

-- "No contactar" bloquea
update public.entity_crm set status_id = (select id from public.crm_statuses where slug = 'no_contactar' and workspace_id = '10000000-0000-0000-0000-000000000001');
select pg_temp.check('No contactar bloquea el contacto',
  not public.can_contact('10000000-0000-0000-0000-000000000001', (select id from public.entities where name = 'Club BTT Ultreia')));

-- 4. Usuario de otro espacio no ve el CRM ---------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select pg_temp.check('usuario sin espacio no ve CRM ni entidades',
  (select count(*) = 0 from public.entity_crm) and (select count(*) = 0 from public.entities));

-- 5. Búsqueda y mapa ------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check('búsqueda tolera erratas y acentos ("compostelno")',
  exists (select 1 from public.search_entities('10000000-0000-0000-0000-000000000001', 'compostelno') where name ilike '%compostelano%'));
select pg_temp.check('búsqueda sin acento encuentra "Lázaro"',
  exists (select 1 from public.search_entities('10000000-0000-0000-0000-000000000001', 'san lazaro')));
select pg_temp.check('filtro por estado CRM',
  (select count(*) = 1 from public.search_entities('10000000-0000-0000-0000-000000000001', p_crm_status => 'no_contactar')));
select pg_temp.check('filtro por categoría (padre incluye hijas)',
  (select count(*) from public.search_entities('10000000-0000-0000-0000-000000000001', p_category => 'comercio.deporte', p_limit => 200))
  = (select least(count(*), 200) from public.entities where entity_type = 'comercio' and merged_into is null));

-- Paginación por cursor: recorrer todas las páginas sin solapes ni huecos
do $$
declare
  total int; seen int := 0; distinct_seen int; pages int := 0;
  k text := null; i uuid := null; r record;
begin
  select count(*) into total from public.entities where merged_into is null;
  create temp table t_seen (id uuid) on commit drop;
  loop
    pages := pages + 1;
    r := null;
    for r in select * from public.search_entities('10000000-0000-0000-0000-000000000001', p_limit => 200,
                                                   p_after_key => k, p_after_id => i) loop
      insert into t_seen values (r.id);
      seen := seen + 1;
      k := r.sort_key; i := r.id;
    end loop;
    exit when r is null or seen >= total or pages > 50;
  end loop;
  select count(distinct id) into distinct_seen from t_seen;
  perform pg_temp.check('paginación por cursor cubre todo sin solapes', seen = total and distinct_seen = total,
                        format('%s vistas, %s distintas de %s en %s páginas', seen, distinct_seen, total, pages));
end $$;

select pg_temp.check('mapa agrupa a zoom bajo',
  (public.map_features('10000000-0000-0000-0000-000000000001', -9.5, 42.0, -7.5, 43.8, 7, p_max_points => 5) ->> 'clustered')::boolean);
select pg_temp.check('mapa devuelve puntos a zoom alto',
  (select (f ->> 'clustered') = 'false' and jsonb_array_length(f -> 'features') > 0
   from (select public.map_features('10000000-0000-0000-0000-000000000001', -8.60, 42.84, -8.50, 42.92, 15) f) x));
select pg_temp.check('mapa rechaza áreas enormes',
  (public.map_features('10000000-0000-0000-0000-000000000001', -180, -80, 180, 80, 2) ->> 'error') = 'bbox_invalid');

-- 6. Fusión y reversión (admin) --------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare
  a uuid; b uuid; ev uuid; rec_b int;
begin
  select id into a from public.entities where name = 'Club Ciclista Rey';
  select id into b from public.entities where name = 'Rutas Celtas BTT';
  select count(*) into rec_b from public.entity_sources where entity_id = b;
  ev := public.merge_entities(a, b);
  perform pg_temp.check('fusión mueve las fuentes', (select count(*) = 0 from public.entity_sources where entity_id = b)
                                                 and (select merged_into = a from public.entities where id = b));
  perform pg_temp.check('fusión auditada', exists (select 1 from public.audit_log where action = 'entity.merge'));
  perform public.revert_merge(ev);
  perform pg_temp.check('reversión restaura la entidad',
    (select count(*) = rec_b from public.entity_sources where entity_id = b)
    and (select merged_into is null from public.entities where id = b)
    and (select name = 'Rutas Celtas BTT' from public.entities where id = b));
end $$;
select pg_temp.check('admin ve la auditoría', (select count(*) > 0 from public.audit_log));

reset role;

-- 7. Importaciones: no se duplican trabajos activos --------------------------------
do $$ begin
  perform public.request_import('osm', array['15078']);
  begin
    perform public.request_import('osm', array['15078']);
    perform pg_temp.check('no permite dos importaciones activas iguales', false, 'creó duplicado');
  exception when unique_violation then
    perform pg_temp.check('no permite dos importaciones activas iguales', true);
  end;
end $$;

select case when ok then 'OK   ' else 'FALLO' end as resultado, name, coalesce(detail, '') as detalle from t_results;
select count(*) filter (where not ok) > 0 as fallos from t_results \gset
\if :fallos
  \echo 'HAY PRUEBAS FALLIDAS'
  rollback;
  \quit 3
\endif
rollback;
