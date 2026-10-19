-- Pruebas de la clasificación comercial (roles), la próxima acción y los indicadores.
-- Requiere datos importados (clubes del RED y comercios de OSM). Se deshace al final.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'comercial@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'lector@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'ajeno@test.local');
insert into public.workspaces (id, name, slug) values
  ('20000000-0000-0000-0000-000000000001', 'Equipo de prueba', 'prueba-roles'),
  ('20000000-0000-0000-0000-000000000002', 'Otro equipo', 'otro-roles');
insert into public.memberships (workspace_id, user_id, role) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'comercial'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'lector'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', 'admin');

create temp table t_results (name text, ok boolean, detail text) on commit drop;
grant all on t_results to authenticated, anon;
create or replace function pg_temp.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into t_results values (p_name, coalesce(p_ok, false), p_detail) $$;

-- Entidades de referencia: un club y un comercio con contacto.
create temp table t_ref on commit drop as
select (select e.id from public.entities e where e.entity_type = 'club' and e.merged_into is null
          and exists (select 1 from public.contact_points cp where cp.entity_id = e.id) order by e.id limit 1) as club,
       (select e.id from public.entities e where e.entity_type = 'club' and e.merged_into is null
          and exists (select 1 from public.contact_points cp where cp.entity_id = e.id) order by e.id desc limit 1) as club2,
       (select e.id from public.entities e where e.entity_type = 'comercio' and e.merged_into is null order by e.id limit 1) as shop,
       (select count(*) from public.entities where merged_into is null and entity_type in ('club', 'asociacion', 'comunidad')) as n_buyers,
       (select count(*) from public.entities where merged_into is null and entity_type in ('comercio', 'distribuidor')) as n_sellers;
grant select on t_ref to authenticated;

-- 1. Roles por defecto e indicadores iniciales -------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check('KPI compradores potenciales = clubes + asociaciones',
  (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'buyers_potential')::int = (select n_buyers from t_ref),
  public.dashboard_kpis('20000000-0000-0000-0000-000000000001')::text);
select pg_temp.check('KPI vendedores potenciales = comercios',
  (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'sellers_potential')::int = (select n_sellers from t_ref));
select pg_temp.check('KPI participantes = 0 sin marcas verificadas',
  (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'participants')::int = 0);
select pg_temp.check('búsqueda por rol comprador potencial solo devuelve clubes/asociaciones',
  (select bool_and(entity_type in ('club', 'asociacion', 'comunidad')) and count(*) > 0
     from public.search_entities('20000000-0000-0000-0000-000000000001', p_limit => 200, p_role => 'comprador_potencial')));

-- 2. Comercial cambia roles potenciales (una entidad puede ser comprador y vendedor) ---
select public.set_entity_roles('20000000-0000-0000-0000-000000000001', (select club from t_ref), true, true, false, null, false, null);
select pg_temp.check('comercial marca un club también como vendedor potencial',
  (select seller_potential and buyer_potential from public.entity_effective_roles
    where workspace_id = '20000000-0000-0000-0000-000000000001' and entity_id = (select club from t_ref)));
select pg_temp.check('la entidad con dos roles cuenta en ambos indicadores sin duplicar el total',
  (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'sellers_potential')::int = (select n_sellers + 1 from t_ref)
  and (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'entities')::int
      = (select count(*) from public.entities where merged_into is null));
select pg_temp.check('el cambio de roles queda en el historial',
  exists (select 1 from public.crm_events where kind = 'roles_changed' and entity_id = (select club from t_ref)));

-- 3. Participación: solo admin/editor y con prueba ---------------------------------
do $$ begin
  begin
    perform public.set_entity_roles('20000000-0000-0000-0000-000000000001', (select club from t_ref), true, true, true, 'gropo:club/123', false, null);
    perform pg_temp.check('comercial no puede marcar participación en GROPO', false, 'pudo marcar');
  exception when insufficient_privilege then
    perform pg_temp.check('comercial no puede marcar participación en GROPO', true);
  end;
end $$;
do $$ begin
  begin
    insert into public.entity_roles (workspace_id, entity_id, buyer_potential, seller_potential, buyer_participant, buyer_evidence, buyer_verified_at)
    values ('20000000-0000-0000-0000-000000000001', (select club2 from t_ref), true, false, true, 'x123', now());
    perform pg_temp.check('nadie escribe roles directamente en la tabla', false, 'pudo insertar');
  exception when insufficient_privilege then
    perform pg_temp.check('nadie escribe roles directamente en la tabla', true);
  end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  begin
    perform public.set_entity_roles('20000000-0000-0000-0000-000000000001', (select club from t_ref), true, true, true, '  ', false, null);
    perform pg_temp.check('participación sin prueba se rechaza', false, 'se aceptó');
  exception when check_violation then
    perform pg_temp.check('participación sin prueba se rechaza', true);
  end;
end $$;
select public.set_entity_roles('20000000-0000-0000-0000-000000000001', (select club from t_ref), true, true, true, 'https://gropo.es/clubes/123', false, null);
select pg_temp.check('admin marca participante con prueba; queda quién y cuándo',
  (select buyer_participant and buyer_evidence = 'https://gropo.es/clubes/123'
          and buyer_verified_by = '00000000-0000-0000-0000-0000000000a1' and buyer_verified_at is not null
     from public.entity_roles where workspace_id = '20000000-0000-0000-0000-000000000001' and entity_id = (select club from t_ref)));
select pg_temp.check('KPI participantes = 1 y el participante deja de contar como comprador potencial',
  (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'participants')::int = 1
  and (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'buyer_participants')::int = 1
  and (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'buyers_potential')::int = (select n_buyers - 1 from t_ref));
select pg_temp.check('búsqueda por participante encuentra la entidad',
  (select count(*) = 1 from public.search_entities('20000000-0000-0000-0000-000000000001', p_role => 'participante')));
reset role;
select pg_temp.check('la participación queda en la auditoría',
  exists (select 1 from public.audit_log where action = 'entity.participation' and target_id = (select club::text from t_ref)));
set local role authenticated;

-- Comercial puede seguir cambiando roles potenciales sin tocar la participación.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select public.set_entity_roles('20000000-0000-0000-0000-000000000001', (select club from t_ref), true, false, true, 'https://gropo.es/clubes/123', false, null);
select pg_temp.check('comercial cambia potenciales sin alterar la participación verificada',
  (select buyer_participant and not seller_potential and buyer_verified_by = '00000000-0000-0000-0000-0000000000a1'
     from public.entity_roles where workspace_id = '20000000-0000-0000-0000-000000000001' and entity_id = (select club from t_ref)));

-- 4. Lector y otros equipos ---------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  begin
    perform public.set_entity_roles('20000000-0000-0000-0000-000000000001', (select club2 from t_ref), false, true, false, null, false, null);
    perform pg_temp.check('lector no puede cambiar la clasificación', false, 'pudo cambiar');
  exception when insufficient_privilege then
    perform pg_temp.check('lector no puede cambiar la clasificación', true);
  end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.check('otro equipo no ve los roles de este equipo',
  not exists (select 1 from public.entity_roles where workspace_id = '20000000-0000-0000-0000-000000000001'));
select pg_temp.check('otro equipo no obtiene indicadores de este equipo',
  (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'entities')::int = 0);

-- 5. Próxima acción y seguimiento --------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  begin
    insert into public.entity_crm (workspace_id, entity_id, status_id, next_action)
    values ('20000000-0000-0000-0000-000000000001', (select club2 from t_ref),
            (select id from public.crm_statuses where workspace_id = '20000000-0000-0000-0000-000000000001' and slug = 'contactado'),
            'Llamar');
    perform pg_temp.check('próxima acción sin fecha se rechaza', false, 'se aceptó');
  exception when check_violation then
    perform pg_temp.check('próxima acción sin fecha se rechaza', true);
  end;
end $$;
select (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'first_contact')::int as fc_before \gset
insert into public.entity_crm (workspace_id, entity_id, status_id, priority, next_action, next_action_at)
values ('20000000-0000-0000-0000-000000000001', (select club2 from t_ref),
        (select id from public.crm_statuses where workspace_id = '20000000-0000-0000-0000-000000000001' and slug = 'contactado'),
        1, 'Llamar para presentar GROPO', public.today_madrid() - 1);
select pg_temp.check('seguimiento vencido aparece en follow_ups',
  (select overdue and is_buyer from public.follow_ups where entity_id = (select club2 from t_ref)));
select pg_temp.check('KPI vencidos = 1 y seguimientos = 1',
  (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'overdue')::int = 1
  and (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'follow_ups')::int = 1);
select pg_temp.check('la entidad con seguimiento sale de «primer contacto»',
  (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'first_contact')::int = :fc_before - 1);
select pg_temp.check('búsqueda por vencidos y prioridad alta',
  (select count(*) = 1 from public.search_entities('20000000-0000-0000-0000-000000000001', p_follow => 'vencido', p_priority => 1::smallint)));
select pg_temp.check('la próxima acción queda en el historial',
  exists (select 1 from public.crm_events where kind = 'next_action_changed' and entity_id = (select club2 from t_ref)));

update public.entity_crm set status_id = (select id from public.crm_statuses where workspace_id = '20000000-0000-0000-0000-000000000001' and slug = 'no_contactar')
where workspace_id = '20000000-0000-0000-0000-000000000001' and entity_id = (select club2 from t_ref);
select pg_temp.check('«No contactar» saca la entidad del seguimiento',
  not exists (select 1 from public.follow_ups where entity_id = (select club2 from t_ref))
  and (public.dashboard_kpis('20000000-0000-0000-0000-000000000001') ->> 'follow_ups')::int = 0);

-- 6. Filtros territoriales y mapa ---------------------------------------------------
select pg_temp.check('filtro por provincia',
  (select bool_and(left(municipality_code, 2) = '36') and count(*) > 0
     from public.search_entities('20000000-0000-0000-0000-000000000001', p_limit => 200, p_province => '36')));
select pg_temp.check('la búsqueda devuelve el nombre de la provincia',
  (select bool_and(province_name is not null) from public.search_entities('20000000-0000-0000-0000-000000000001', p_limit => 50)));
select pg_temp.check('mapa filtra por rol vendedor potencial',
  (public.map_features('20000000-0000-0000-0000-000000000001', -9.5, 41.8, -6.7, 43.9, 15, p_role => 'vendedor_potencial') ->> 'total')::int
  = (select count(*) from public.entities where merged_into is null and geom is not null and entity_type in ('comercio', 'distribuidor')));

-- 7. Fusiones conservan los roles --------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.merge_entities((select club2 from t_ref), (select club from t_ref)) as merge_ev \gset
select pg_temp.check('al fusionar, la superviviente hereda la participación verificada',
  (select buyer_participant from public.entity_roles where workspace_id = '20000000-0000-0000-0000-000000000001' and entity_id = (select club2 from t_ref)));
select public.revert_merge(:'merge_ev');
select pg_temp.check('al deshacer la fusión, la participación vuelve a su entidad',
  (select buyer_participant from public.entity_roles where workspace_id = '20000000-0000-0000-0000-000000000001' and entity_id = (select club from t_ref)));

select case when ok then ' OK    ' else ' FALLO ' end || name || coalesce(' (' || detail || ')', '') as resultado from t_results;
do $$ begin
  if exists (select 1 from t_results where not ok) then raise exception 'Hay pruebas que fallan'; end if;
end $$;
rollback;
