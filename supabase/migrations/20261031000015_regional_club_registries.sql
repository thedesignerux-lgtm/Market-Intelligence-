-- Clubes desde los registros autonómicos de entidades deportivas publicados en abierto.
-- Licencias comprobadas el 31/10/2026 en cada portal.

insert into public.sources (id, name, kind, license, license_url, attribution, homepage, default_confidence) values
  ('registro_cataluna', 'Registre d''Entitats Esportives de Catalunya (Generalitat)', 'open_data',
   'Llicència oberta d''ús d''informació - Catalunya',
   'https://administraciodigital.gencat.cat/ca/dades/dades-obertes/informacio-practica/llicencies/',
   'Generalitat de Catalunya · Registre d''Entitats Esportives', 'https://analisi.transparenciacatalunya.cat/d/qrgc-u7pk', 0.85),
  ('registro_euskadi', 'Registro de Entidades Deportivas del País Vasco (Gobierno Vasco)', 'open_data',
   'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
   'Open Data Euskadi · Gobierno Vasco', 'https://opendata.euskadi.eus/contenidos/ds_localizaciones/entidades_deportivas/opendata/clubes.geojson', 0.85),
  ('registro_navarra', 'Registro de Entidades Deportivas y Federaciones de Navarra (Gobierno de Navarra)', 'open_data',
   'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
   'Gobierno de Navarra · Datos abiertos', 'https://datosabiertos.navarra.es/dataset/9bb4acb3-06ff-46fc-87e1-ad69e8458652', 0.85),
  ('registro_canarias', 'Registro de Entidades Deportivas de Canarias (Gobierno de Canarias)', 'open_data',
   'CC BY 4.0', 'https://datos.canarias.es/portal/aviso-legal-y-condiciones-de-uso',
   'Gobierno de Canarias · datos.canarias.es', 'https://datos.canarias.es/catalogos/general/dataset/0bbaa04b-4c96-4652-835d-3ffed1ae7a9b', 0.80)
on conflict (id) do nothing;

-- Todos los adaptadores emiten la modalidad canónica CICLISMO para los clubes de ciclismo.
insert into public.category_mappings (source_id, match, category_id, entity_type, priority)
select s.id, '{"modalidad": "CICLISMO"}'::jsonb, 'club.deportivo.ciclismo', 'club', 200
  from unnest(array['registro_cataluna', 'registro_euskadi', 'registro_navarra', 'registro_canarias']) as s(id)
 where not exists (select 1 from public.category_mappings m where m.source_id = s.id and m.match = '{"modalidad": "CICLISMO"}'::jsonb);

-- Identificador de inscripción en un registro autonómico: valor "<fuente>/<número>".
alter table public.entity_identifiers drop constraint entity_identifiers_scheme_check;
alter table public.entity_identifiers add constraint entity_identifiers_scheme_check
  check (scheme in ('nif', 'red_galicia', 'osm', 'wikidata', 'registro'));

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
  -- Fuentes importables: OpenStreetMap y los registros de datos abiertos dados de alta en public.sources.
  if not exists (select 1 from public.sources s where s.id = p_source and s.kind in ('osm', 'open_data')) then
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
