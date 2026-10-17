-- 0011 · Vistas de resumen para la pantalla principal (respetan RLS: security_invoker)

create or replace view public.municipality_summary
with (security_invoker = true) as
select aa.code as municipality_code,
       aa.name as municipality_name,
       count(*) as entities,
       count(*) filter (where e.entity_type = 'comercio') as comercios,
       count(*) filter (where e.entity_type = 'club') as clubes,
       count(*) filter (where e.entity_type not in ('comercio', 'club')) as otras,
       count(*) filter (where e.geom is not null) as con_ubicacion,
       count(*) filter (where e.status = 'unverified') as sin_verificar,
       array(select distinct sr.source_id
               from public.entity_sources es
               join public.source_records sr on sr.id = es.source_record_id
               join public.entities e2 on e2.id = es.entity_id
              where e2.municipality_code = aa.code and e2.merged_into is null
              order by 1) as sources,
       max(e.last_seen_at) as last_seen_at
from public.admin_areas aa
join public.entities e on e.municipality_code = aa.code and e.merged_into is null
where aa.level = 'municipio'
group by aa.code, aa.name;

grant select on public.municipality_summary to authenticated;
revoke all on public.municipality_summary from anon;
