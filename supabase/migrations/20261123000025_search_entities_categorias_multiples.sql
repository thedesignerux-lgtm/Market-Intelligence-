-- Selector de categorías con selección múltiple.
--
-- search_entities acepta ahora una lista de categorías. p_category se conserva y se suma a la
-- lista, igual que se hizo con el territorio: así los enlaces antiguos (?categoria=club.deportivo)
-- y el despliegue anterior siguen funcionando mientras sale la versión nueva.
--
-- Seleccionar una categoría madre sigue incluyendo a sus hijas, como antes.
-- Las «familias» del selector (Comercios y distribuidores, Servicios, Organizaciones
-- deportivas, Comunidades) son solo agrupación visual, viven en
-- src/lib/domain/category-families.ts y no se guardan en la base de datos: aquí no se crea
-- ninguna categoría ni se cambia ningún identificador.

drop function public.search_entities(uuid, text, public.entity_type[], text, text, text, int, real, text, uuid, text, smallint, text, text, text[], text[], text[]);
create function public.search_entities(
  p_workspace     uuid,
  p_q             text default null,
  p_types         public.entity_type[] default null,
  p_category      text default null,
  p_municipality  text default null,
  p_crm_status    text default null,
  p_limit         int default 50,
  p_after_score   real default null,
  p_after_key     text default null,
  p_after_id      uuid default null,
  p_province      text default null,
  p_priority      smallint default null,
  p_role          text default null,
  p_follow        text default null,
  -- Selección territorial nueva. p_province y p_municipality se mantienen por compatibilidad:
  -- los enlaces antiguos y cualquier despliegue anterior siguen funcionando.
  p_provinces     text[] default null,
  p_municipalities text[] default null,
  p_exclude_municipalities text[] default null,
  -- Varias categorías. p_category se mantiene por compatibilidad y se suma a la lista.
  p_categories    text[] default null
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
  province_name      text,
  lat                float8,
  lon                float8,
  location_precision public.location_precision,
  status             public.entity_status,
  crm_status         text,
  crm_status_label   text,
  priority           smallint,
  next_action        text,
  next_action_at     date,
  buyer_potential    boolean,
  seller_potential   boolean,
  buyer_participant  boolean,
  seller_participant boolean,
  has_contact        boolean,
  contact_blocked    boolean,
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
  today date := public.today_madrid();
  provs text[] := coalesce(p_provinces, '{}'::text[])
                  || case when p_province is null then '{}'::text[] else array[p_province] end;
  munis text[] := coalesce(p_municipalities, '{}'::text[])
                  || case when p_municipality is null then '{}'::text[] else array[p_municipality] end;
  excl  text[] := coalesce(p_exclude_municipalities, '{}'::text[]);
  cats  text[] := coalesce(p_categories, '{}'::text[])
                  || case when p_category is null then '{}'::text[] else array[p_category] end;
begin
  if qn is not null then
    perform set_config('pg_trgm.word_similarity_threshold', '0.35', true);
  end if;

  return query
  with base as (
    select e.*,
           case when qn is null then null::real
                else greatest(similarity(e.search_text, qn), word_similarity(qn, e.search_text))::real end as sc,
           coalesce(r.buyer_potential, public.default_buyer(e.entity_type))   as r_bp,
           coalesce(r.seller_potential, public.default_seller(e.entity_type)) as r_sp,
           coalesce(r.buyer_participant, false)  as r_bpart,
           coalesce(r.seller_participant, false) as r_spart,
           exists (select 1 from contact_points cp where cp.entity_id = e.id) as r_contact,
           c.status_id as c_status, c.priority as c_priority, c.next_action as c_action, c.next_action_at as c_at,
           s.slug as s_slug, s.label as s_label, coalesce(s.blocks_contact, false) as s_blocks
    from entities e
    left join entity_roles r on r.entity_id = e.id and r.workspace_id = p_workspace
    left join entity_crm c on c.entity_id = e.id and c.workspace_id = p_workspace
    left join crm_statuses s on s.id = c.status_id
    where e.merged_into is null
      and (qn is null or qn <% e.search_text or e.search_text like '%' || qn || '%')
      and (p_types is null or e.entity_type = any (p_types))
      -- Territorio: las provincias y los municipios sueltos se suman; los municipios
      -- excluidos se restan. Sin nada seleccionado no filtra: el ámbito es toda España.
      and (
        (cardinality(provs) = 0 and cardinality(munis) = 0)
        or left(e.municipality_code, 2) = any (provs)
        or e.municipality_code = any (munis)
      )
      and (
        cardinality(excl) = 0
        or e.municipality_code is null
        or not (e.municipality_code = any (excl))
      )
      -- Categoría: seleccionar una madre sigue incluyendo a sus hijas.
      and (cardinality(cats) = 0 or exists (
            select 1 from entity_categories ec join categories cg on cg.id = ec.category_id
            where ec.entity_id = e.id and (cg.id = any (cats) or cg.parent_id = any (cats))))
      and (p_crm_status is null or (case when p_crm_status = 'sin_estado' then c.status_id is null else s.slug = p_crm_status end))
      and (p_priority is null or c.priority = p_priority)
  ),
  filtered as (
    select b.* from base b
    where (p_role is null or case p_role
             when 'comprador_potencial'    then b.r_bp and not b.r_bpart
             when 'vendedor_potencial'     then b.r_sp and not b.r_spart
             when 'participante'           then b.r_bpart or b.r_spart
             when 'comprador_participante' then b.r_bpart
             when 'vendedor_participante'  then b.r_spart
             when 'sin_rol'                then not (b.r_bp or b.r_sp or b.r_bpart or b.r_spart)
             else false end)
      and (p_follow is null or case p_follow
             when 'primer_contacto' then (b.r_bp or b.r_sp) and not (b.r_bpart or b.r_spart) and b.r_contact
                                         and (b.s_slug is null or b.s_slug in ('nuevo', 'pendiente'))
                                         and b.c_at is null and not b.s_blocks
             when 'seguimiento'     then b.c_at is not null and not b.s_blocks
             when 'vencido'         then b.c_at is not null and b.c_at < today and not b.s_blocks
             when 'pendiente'       then not b.s_blocks and (b.c_at is not null or (
                                           (b.r_bp or b.r_sp) and not (b.r_bpart or b.r_spart) and b.r_contact
                                           and (b.s_slug is null or b.s_slug in ('nuevo', 'pendiente'))))
             else false end)
  )
  select b.id, b.entity_type, b.name, b.category_id, cat.name, b.address, b.postal_code,
         b.municipality_code, aa.name, prov.name,
         st_y(b.geom), st_x(b.geom), b.location_precision, b.status,
         b.s_slug, b.s_label, b.c_priority, b.c_action, b.c_at,
         b.r_bp, b.r_sp, b.r_bpart, b.r_spart, b.r_contact, b.s_blocks,
         (select array_agg(distinct sr.source_id order by sr.source_id) from entity_sources es
            join source_records sr on sr.id = es.source_record_id where es.entity_id = b.id),
         b.sc, b.normalized_name
  from filtered b
  left join categories cat on cat.id = b.category_id
  left join admin_areas aa on aa.code = b.municipality_code
  left join admin_areas prov on prov.code = left(b.municipality_code, 2)
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
revoke all on function public.search_entities(uuid, text, public.entity_type[], text, text, text, int, real, text, uuid, text, smallint, text, text, text[], text[], text[], text[]) from public, anon;
grant execute on function public.search_entities(uuid, text, public.entity_type[], text, text, text, int, real, text, uuid, text, smallint, text, text, text[], text[], text[], text[]) to authenticated;
