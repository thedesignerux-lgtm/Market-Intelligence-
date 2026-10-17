-- 0008 · Consultas para la aplicación: búsqueda, mapa, cobertura y control de importaciones
-- Las funciones de lectura son SECURITY INVOKER: respetan RLS del usuario que consulta.

-- Búsqueda con filtros y paginación por cursor.
-- Con texto: orden por relevancia (cursor = score + id). Sin texto: orden alfabético (cursor = clave + id).
create or replace function public.search_entities(
  p_workspace     uuid,
  p_q             text default null,
  p_types         public.entity_type[] default null,
  p_category      text default null,
  p_municipality  text default null,
  p_crm_status    text default null,
  p_limit         int default 50,
  p_after_score   real default null,
  p_after_key     text default null,
  p_after_id      uuid default null
)
returns table (
  id                 uuid,
  entity_type        public.entity_type,
  name               text,
  category_id        text,
  category_name      text,
  address            text,
  postal_code        text,
  municipality_code  text,
  municipality_name  text,
  lat                float8,
  lon                float8,
  location_precision public.location_precision,
  status             public.entity_status,
  crm_status         text,
  crm_status_label   text,
  sources            text[],
  score              real,
  sort_key           text
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  qn text := nullif(public.search_normalize(coalesce(p_q, '')), '');
  lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if qn is not null then
    perform set_config('pg_trgm.word_similarity_threshold', '0.35', true);
  end if;

  return query
  with base as (
    select e.*,
           case when qn is null then null::real
                else greatest(similarity(e.search_text, qn), word_similarity(qn, e.search_text))::real end as sc
    from entities e
    where e.merged_into is null
      and (qn is null or qn <% e.search_text or e.search_text like '%' || qn || '%')
      and (p_types is null or e.entity_type = any (p_types))
      and (p_municipality is null or e.municipality_code = p_municipality)
      and (p_category is null or exists (
            select 1 from entity_categories ec join categories c on c.id = ec.category_id
            where ec.entity_id = e.id and (c.id = p_category or c.parent_id = p_category)))
      and (p_crm_status is null or (
            case when p_crm_status = 'sin_estado'
                 then not exists (select 1 from entity_crm x where x.entity_id = e.id and x.workspace_id = p_workspace)
                 else exists (select 1 from entity_crm x join crm_statuses s on s.id = x.status_id
                              where x.entity_id = e.id and x.workspace_id = p_workspace and s.slug = p_crm_status) end))
  )
  select b.id, b.entity_type, b.name, b.category_id, cat.name, b.address, b.postal_code,
         b.municipality_code, aa.name,
         st_y(b.geom), st_x(b.geom), b.location_precision, b.status,
         s.slug, s.label,
         (select array_agg(distinct sr.source_id order by sr.source_id) from entity_sources es
            join source_records sr on sr.id = es.source_record_id where es.entity_id = b.id),
         b.sc, b.normalized_name
  from base b
  left join categories cat on cat.id = b.category_id
  left join admin_areas aa on aa.code = b.municipality_code
  left join entity_crm c on c.entity_id = b.id and c.workspace_id = p_workspace
  left join crm_statuses s on s.id = c.status_id
  where case
    when qn is not null and p_after_id is not null then (b.sc < p_after_score or (b.sc = p_after_score and b.id > p_after_id))
    when qn is null and p_after_id is not null then (b.normalized_name > p_after_key or (b.normalized_name = p_after_key and b.id > p_after_id))
    else true end
  order by
    case when qn is not null then b.sc end desc nulls last,
    case when qn is null then b.normalized_name end asc,
    b.id asc
  limit lim;
end;
$$;

-- Datos del mapa para el área visible. Nunca devuelve más de p_max_points puntos:
-- si hay demasiados o el zoom es bajo, agrupa en celdas (clustering en servidor).
-- Es una sola consulta de lectura para que funcione en transacciones de solo lectura.
create or replace function public.map_features(
  p_workspace   uuid,
  p_west        float8,
  p_south       float8,
  p_east        float8,
  p_north       float8,
  p_zoom        int,
  p_types       public.entity_type[] default null,
  p_category    text default null,
  p_crm_status  text default null,
  p_max_points  int default 1500
)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  with f as (
    select e.id, e.geom, e.name, e.entity_type, e.category_id, s.slug as crm_status
    from entities e
    left join entity_crm c on c.entity_id = e.id and c.workspace_id = p_workspace
    left join crm_statuses s on s.id = c.status_id
    where e.merged_into is null and e.geom is not null
      and e.geom && st_makeenvelope(p_west, p_south, p_east, p_north, 4326)
      and (p_types is null or e.entity_type = any (p_types))
      and (p_category is null or exists (
            select 1 from entity_categories ec join categories cg on cg.id = ec.category_id
            where ec.entity_id = e.id and (cg.id = p_category or cg.parent_id = p_category)))
      and (p_crm_status is null or (case when p_crm_status = 'sin_estado' then s.slug is null else s.slug = p_crm_status end))
  ),
  n as (select count(*)::int as total from f),
  points as (
    select jsonb_agg(jsonb_build_object(
             'type', 'Feature',
             'geometry', st_asgeojson(geom, 6)::jsonb,
             'properties', jsonb_build_object('id', id, 'name', name, 'entity_type', entity_type,
                                              'category_id', category_id, 'crm_status', crm_status))) as features
    from (select * from f limit least(p_max_points, 5000)) x
  ),
  clusters as (
    select jsonb_agg(jsonb_build_object(
             'type', 'Feature',
             'geometry', st_asgeojson(center, 6)::jsonb,
             'properties', case when cnt = 1
               then jsonb_build_object('id', one_id, 'name', one_name, 'entity_type', one_type,
                                       'category_id', one_cat, 'crm_status', one_status)
               else jsonb_build_object('cluster', true, 'count', cnt,
                      'bbox', jsonb_build_array(st_xmin(ext), st_ymin(ext), st_xmax(ext), st_ymax(ext))) end)) as features
    from (
      select count(*) as cnt, st_centroid(st_collect(geom)) as center, st_extent(geom)::geometry as ext,
             (array_agg(id))[1] as one_id, (array_agg(name))[1] as one_name, (array_agg(entity_type))[1] as one_type,
             (array_agg(category_id))[1] as one_cat, (array_agg(crm_status))[1] as one_status
      from f
      -- Celda ≈ 60 px de pantalla al zoom actual.
      group by st_snaptogrid(geom, (360.0 / power(2, greatest(p_zoom, 0))) * (60.0 / 256.0))
    ) g
  )
  select case
    when p_east - p_west > 30 or p_north - p_south > 30 or p_east <= p_west or p_north <= p_south
      then jsonb_build_object('type', 'FeatureCollection', 'error', 'bbox_invalid', 'features', '[]'::jsonb)
    when p_zoom >= 15 or (select total from n) <= p_max_points
      then jsonb_build_object('type', 'FeatureCollection', 'total', (select total from n), 'clustered', false,
                              'features', coalesce((select features from points), '[]'::jsonb))
    else jsonb_build_object('type', 'FeatureCollection', 'total', (select total from n), 'clustered', true,
                            'features', coalesce((select features from clusters), '[]'::jsonb))
  end
$$;

-- Cobertura: qué hay importado por municipio y fuente, y cuándo se actualizó.
create or replace view public.coverage_by_municipality
with (security_invoker = true) as
select aa.code as municipality_code,
       aa.name as municipality_name,
       sr.source_id,
       count(distinct es.entity_id) as entities,
       max(sr.last_seen_at) as last_seen_at
from public.admin_areas aa
join public.entities e on e.municipality_code = aa.code and e.merged_into is null
join public.entity_sources es on es.entity_id = e.id
join public.source_records sr on sr.id = es.source_record_id
where aa.level = 'municipio'
group by aa.code, aa.name, sr.source_id;

-- Solicitar una importación (admin/editor). Crea una tarea por municipio.
create or replace function public.request_import(p_source text, p_municipalities text[], p_categories text[] default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  m text;
begin
  if not public.has_role_anywhere(array['admin', 'editor']::public.app_role[]) and auth.uid() is not null then
    raise exception 'Permiso denegado: se requiere rol admin o editor' using errcode = '42501';
  end if;
  if p_source not in ('osm', 'red_galicia') then
    raise exception 'Fuente no importable: %', p_source using errcode = '22023';
  end if;
  if coalesce(array_length(p_municipalities, 1), 0) = 0 or array_length(p_municipalities, 1) > 400 then
    raise exception 'Indica entre 1 y 400 municipios' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_municipalities) u where u !~ '^[0-9]{5}$') then
    raise exception 'Código de municipio no válido' using errcode = '22023';
  end if;

  begin
    insert into public.import_runs (source_id, scope, requested_by)
    values (p_source, jsonb_build_object('municipalities', to_jsonb((select array_agg(x order by x) from unnest(p_municipalities) x)),
                                         'categories', to_jsonb(p_categories)),
            auth.uid())
    returning id into v_run;
  exception when unique_violation then
    raise exception 'Ya hay una importación activa con la misma fuente y alcance' using errcode = '23505';
  end;

  foreach m in array p_municipalities loop
    insert into public.import_tasks (run_id, task_key, params)
    values (v_run, p_source || ':' || m, jsonb_build_object('municipality', m, 'categories', to_jsonb(p_categories)))
    on conflict do nothing;
  end loop;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'import.request', 'import_run', v_run::text,
          jsonb_build_object('source', p_source, 'municipalities', p_municipalities));
  return v_run;
end;
$$;

-- Pausar, reanudar o cancelar una importación.
create or replace function public.control_import(p_run uuid, p_action text)
returns public.run_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.run_status;
begin
  if not public.has_role_anywhere(array['admin', 'editor']::public.app_role[]) and auth.uid() is not null then
    raise exception 'Permiso denegado' using errcode = '42501';
  end if;
  select status into cur from public.import_runs where id = p_run for update;
  if not found then raise exception 'Importación no encontrada'; end if;

  if p_action = 'pause' and cur in ('queued', 'running') then
    update public.import_runs set status = 'paused' where id = p_run;
  elsif p_action = 'resume' and cur = 'paused' then
    update public.import_runs set status = 'running' where id = p_run;
    perform public.refresh_import_run(p_run);
  elsif p_action = 'cancel' and cur in ('queued', 'running', 'paused') then
    update public.import_tasks set status = 'cancelled' where run_id = p_run and status = 'queued';
    update public.import_runs set status = 'cancelled', finished_at = now() where id = p_run;
  elsif p_action = 'retry_failed' and cur in ('partial', 'failed') then
    update public.import_tasks set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
      where run_id = p_run and status = 'failed';
    update public.import_runs set status = 'running', finished_at = null where id = p_run;
  else
    raise exception 'Acción "%" no válida en estado %', p_action, cur using errcode = '22023';
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id)
  values (auth.uid(), 'import.' || p_action, 'import_run', p_run::text);
  select status into cur from public.import_runs where id = p_run;
  return cur;
end;
$$;

revoke all on function public.request_import(text, text[], text[]) from public, anon;
revoke all on function public.control_import(uuid, text) from public, anon;
grant execute on function public.request_import(text, text[], text[]) to authenticated;
grant execute on function public.control_import(uuid, text) to authenticated;
