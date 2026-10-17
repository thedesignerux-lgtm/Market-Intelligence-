-- 0012 · Vista de ficha: entidad con coordenadas legibles y nombres de categoría y municipio

create or replace view public.entity_details
with (security_invoker = true) as
select e.id, e.entity_type, e.name, e.category_id, c.name as category_name,
       e.address, e.address_is_personal, e.postal_code, e.municipality_code, aa.name as municipality_name,
       extensions.st_x(e.geom) as lon, extensions.st_y(e.geom) as lat, e.location_precision,
       e.status, e.merged_into, e.first_seen_at, e.last_seen_at, e.updated_at
from public.entities e
left join public.categories c on c.id = e.category_id
left join public.admin_areas aa on aa.code = e.municipality_code;

grant select on public.entity_details to authenticated;
revoke all on public.entity_details from anon;
