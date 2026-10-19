-- 0013 · Clasificación comercial (roles) y próxima acción del seguimiento
--
-- Roles comerciales, independientes del estado del CRM:
-- · Comprador potencial / vendedor potencial: mientras nadie los cambie, se deducen del tipo de
--   entidad (clubes, asociaciones y comunidades → comprador; comercios y distribuidores → vendedor).
-- · Comprador / vendedor participante de GROPO: nunca se deducen. Los marca un admin o editor con
--   una prueba verificable (ID o enlace de la cuenta o del pedido en GROPO) y queda registrado
--   quién y cuándo. Estar en el directorio, haber sido contactado o mostrar interés no cuenta.
-- Una entidad puede tener varios roles a la vez.
--
-- Seguimiento: el CRM gana dos campos, «próxima acción» y su fecha.

-- Roles por defecto según el tipo de entidad.
create or replace function public.default_buyer(t public.entity_type)
returns boolean language sql immutable set search_path = '' as $$
  select t in ('club', 'asociacion', 'comunidad')
$$;
create or replace function public.default_seller(t public.entity_type)
returns boolean language sql immutable set search_path = '' as $$
  select t in ('comercio', 'distribuidor')
$$;

create table public.entity_roles (
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  entity_id           uuid not null references public.entities(id) on delete cascade,
  buyer_potential     boolean not null,
  seller_potential    boolean not null,
  buyer_participant   boolean not null default false,
  seller_participant  boolean not null default false,
  -- Prueba de participación: ID o enlace de la cuenta o pedido en GROPO.
  buyer_evidence      text check (buyer_evidence is null or char_length(btrim(buyer_evidence)) between 3 and 500),
  seller_evidence     text check (seller_evidence is null or char_length(btrim(seller_evidence)) between 3 and 500),
  buyer_verified_by   uuid references auth.users(id) on delete set null,
  buyer_verified_at   timestamptz,
  seller_verified_by  uuid references auth.users(id) on delete set null,
  seller_verified_at  timestamptz,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null,
  primary key (workspace_id, entity_id),
  constraint entity_roles_buyer_evidence check (not buyer_participant or (buyer_evidence is not null and buyer_verified_at is not null)),
  constraint entity_roles_seller_evidence check (not seller_participant or (seller_evidence is not null and seller_verified_at is not null))
);
create index entity_roles_participants_idx on public.entity_roles (workspace_id)
  where buyer_participant or seller_participant;

alter table public.entity_roles enable row level security;
create policy entity_roles_read on public.entity_roles for select to authenticated
  using (public.is_member(workspace_id));
grant select on public.entity_roles to authenticated;
-- Sin escritura directa: solo a través de set_entity_roles(), que valida permisos y prueba.
revoke insert, update, delete, truncate on public.entity_roles from authenticated, anon;

-- Roles efectivos (los guardados o, si no hay, los deducidos del tipo).
create or replace view public.entity_effective_roles
with (security_invoker = true) as
select w.id as workspace_id,
       e.id as entity_id,
       coalesce(r.buyer_potential, public.default_buyer(e.entity_type))   as buyer_potential,
       coalesce(r.seller_potential, public.default_seller(e.entity_type)) as seller_potential,
       coalesce(r.buyer_participant, false)  as buyer_participant,
       coalesce(r.seller_participant, false) as seller_participant,
       r.buyer_evidence, r.buyer_verified_at, r.buyer_verified_by,
       r.seller_evidence, r.seller_verified_at, r.seller_verified_by,
       r.entity_id is not null as is_manual
from public.workspaces w
cross join public.entities e
left join public.entity_roles r on r.workspace_id = w.id and r.entity_id = e.id
where e.merged_into is null;
grant select on public.entity_effective_roles to authenticated;
revoke all on public.entity_effective_roles from anon;

-- Historial: nuevos tipos de evento.
alter table public.crm_events drop constraint crm_events_kind_check;
alter table public.crm_events add constraint crm_events_kind_check check (kind in (
  'status_changed', 'owner_changed', 'priority_changed', 'note_added', 'note_deleted',
  'roles_changed', 'next_action_changed'));

-- Cambiar la clasificación de una entidad.
-- · admin, editor y comercial pueden cambiar los roles potenciales.
-- · Solo admin y editor pueden marcar o quitar la participación en GROPO, siempre con prueba.
create or replace function public.set_entity_roles(
  p_workspace          uuid,
  p_entity             uuid,
  p_buyer_potential    boolean,
  p_seller_potential   boolean,
  p_buyer_participant  boolean,
  p_buyer_evidence     text,
  p_seller_participant boolean,
  p_seller_evidence    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur record;
  v_be text := nullif(btrim(coalesce(p_buyer_evidence, '')), '');
  v_se text := nullif(btrim(coalesce(p_seller_evidence, '')), '');
  v_participation_changed boolean;
begin
  if not public.has_role(p_workspace, array['admin', 'editor', 'comercial']::public.app_role[]) then
    raise exception 'Permiso denegado: tu rol no permite cambiar la clasificación' using errcode = '42501';
  end if;

  select * into cur from public.entity_effective_roles where workspace_id = p_workspace and entity_id = p_entity;
  if not found then
    raise exception 'La entidad no existe o está fusionada' using errcode = 'P0002';
  end if;

  if not coalesce(p_buyer_participant, false) then v_be := null; end if;
  if not coalesce(p_seller_participant, false) then v_se := null; end if;

  v_participation_changed :=
       coalesce(p_buyer_participant, false) is distinct from cur.buyer_participant
    or coalesce(p_seller_participant, false) is distinct from cur.seller_participant
    or v_be is distinct from cur.buyer_evidence
    or v_se is distinct from cur.seller_evidence;

  if v_participation_changed and not public.has_role(p_workspace, array['admin', 'editor']::public.app_role[]) then
    raise exception 'Permiso denegado: solo administradores y editores pueden marcar la participación en GROPO' using errcode = '42501';
  end if;
  if coalesce(p_buyer_participant, false) and v_be is null then
    raise exception 'Indica la prueba de participación como comprador (ID o enlace en GROPO)' using errcode = '23514';
  end if;
  if coalesce(p_seller_participant, false) and v_se is null then
    raise exception 'Indica la prueba de participación como vendedor (ID o enlace en GROPO)' using errcode = '23514';
  end if;

  insert into public.entity_roles as r (
    workspace_id, entity_id, buyer_potential, seller_potential,
    buyer_participant, buyer_evidence, buyer_verified_by, buyer_verified_at,
    seller_participant, seller_evidence, seller_verified_by, seller_verified_at,
    updated_at, updated_by)
  values (
    p_workspace, p_entity, coalesce(p_buyer_potential, false), coalesce(p_seller_potential, false),
    coalesce(p_buyer_participant, false), v_be,
    case when coalesce(p_buyer_participant, false) then
      case when v_be is not distinct from cur.buyer_evidence and cur.buyer_participant then cur.buyer_verified_by else auth.uid() end end,
    case when coalesce(p_buyer_participant, false) then
      case when v_be is not distinct from cur.buyer_evidence and cur.buyer_participant then cur.buyer_verified_at else now() end end,
    coalesce(p_seller_participant, false), v_se,
    case when coalesce(p_seller_participant, false) then
      case when v_se is not distinct from cur.seller_evidence and cur.seller_participant then cur.seller_verified_by else auth.uid() end end,
    case when coalesce(p_seller_participant, false) then
      case when v_se is not distinct from cur.seller_evidence and cur.seller_participant then cur.seller_verified_at else now() end end,
    now(), auth.uid())
  on conflict (workspace_id, entity_id) do update set
    buyer_potential = excluded.buyer_potential, seller_potential = excluded.seller_potential,
    buyer_participant = excluded.buyer_participant, buyer_evidence = excluded.buyer_evidence,
    buyer_verified_by = excluded.buyer_verified_by, buyer_verified_at = excluded.buyer_verified_at,
    seller_participant = excluded.seller_participant, seller_evidence = excluded.seller_evidence,
    seller_verified_by = excluded.seller_verified_by, seller_verified_at = excluded.seller_verified_at,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  insert into public.crm_events (workspace_id, entity_id, actor_id, kind, from_value, to_value)
  values (p_workspace, p_entity, auth.uid(), 'roles_changed',
          jsonb_build_object('buyer_potential', cur.buyer_potential, 'seller_potential', cur.seller_potential,
                             'buyer_participant', cur.buyer_participant, 'seller_participant', cur.seller_participant),
          jsonb_build_object('buyer_potential', coalesce(p_buyer_potential, false), 'seller_potential', coalesce(p_seller_potential, false),
                             'buyer_participant', coalesce(p_buyer_participant, false), 'seller_participant', coalesce(p_seller_participant, false)));

  if v_participation_changed then
    insert into public.audit_log (workspace_id, actor_id, action, target_type, target_id, details)
    values (p_workspace, auth.uid(), 'entity.participation', 'entity', p_entity::text,
            jsonb_build_object('buyer_participant', coalesce(p_buyer_participant, false), 'buyer_evidence', v_be,
                               'seller_participant', coalesce(p_seller_participant, false), 'seller_evidence', v_se));
  end if;
end;
$$;
revoke all on function public.set_entity_roles(uuid, uuid, boolean, boolean, boolean, text, boolean, text) from public, anon;
grant execute on function public.set_entity_roles(uuid, uuid, boolean, boolean, boolean, text, boolean, text) to authenticated;

-- Próxima acción del seguimiento comercial.
alter table public.entity_crm
  add column next_action    text check (next_action is null or char_length(btrim(next_action)) between 1 and 200),
  add column next_action_at date,
  add constraint entity_crm_next_action_complete check ((next_action is null) = (next_action_at is null));
create index entity_crm_next_action_idx on public.entity_crm (workspace_id, next_action_at) where next_action_at is not null;
grant update (next_action, next_action_at) on public.entity_crm to authenticated;

-- Fecha de hoy en España (las fechas de seguimiento son locales).
create or replace function public.today_madrid()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Madrid')::date
$$;

create or replace function public.entity_crm_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
    insert into public.crm_events (workspace_id, entity_id, actor_id, kind, from_value, to_value)
    values (new.workspace_id, new.entity_id, auth.uid(), 'status_changed',
            case when tg_op = 'UPDATE' then (select to_jsonb(s.slug) from public.crm_statuses s where s.id = old.status_id) end,
            (select to_jsonb(s.slug) from public.crm_statuses s where s.id = new.status_id));
  end if;
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    insert into public.crm_events (workspace_id, entity_id, actor_id, kind, from_value, to_value)
    values (new.workspace_id, new.entity_id, auth.uid(), 'owner_changed', to_jsonb(old.owner_id), to_jsonb(new.owner_id));
  end if;
  if tg_op = 'UPDATE' and new.priority is distinct from old.priority then
    insert into public.crm_events (workspace_id, entity_id, actor_id, kind, from_value, to_value)
    values (new.workspace_id, new.entity_id, auth.uid(), 'priority_changed', to_jsonb(old.priority), to_jsonb(new.priority));
  end if;
  if (tg_op = 'INSERT' and new.next_action is not null)
     or (tg_op = 'UPDATE' and (new.next_action is distinct from old.next_action or new.next_action_at is distinct from old.next_action_at)) then
    insert into public.crm_events (workspace_id, entity_id, actor_id, kind, from_value, to_value)
    values (new.workspace_id, new.entity_id, auth.uid(), 'next_action_changed',
            case when tg_op = 'UPDATE' and old.next_action is not null
                 then jsonb_build_object('action', old.next_action, 'date', old.next_action_at) end,
            case when new.next_action is not null
                 then jsonb_build_object('action', new.next_action, 'date', new.next_action_at) end);
  end if;
  return new;
end;
$$;
revoke all on function public.entity_crm_history() from public, anon, authenticated;

-- Búsqueda: se añaden provincia, prioridad, rol y seguimiento, y las columnas comerciales.
-- p_role:   comprador_potencial | vendedor_potencial | participante | comprador_participante | vendedor_participante | sin_rol
-- p_follow: pendiente (= primer_contacto + seguimiento) | primer_contacto | seguimiento | vencido
--   primer_contacto: rol potencial, sin participación, con algún contacto, sin estado o en Nuevo/Pendiente,
--                    sin próxima acción y que no haya pedido no ser contactada.
drop function public.search_entities(uuid, text, public.entity_type[], text, text, text, int, real, text, uuid);
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
  p_follow        text default null
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
      and (p_municipality is null or e.municipality_code = p_municipality)
      and (p_province is null or left(e.municipality_code, 2) = p_province)
      and (p_category is null or exists (
            select 1 from entity_categories ec join categories cg on cg.id = ec.category_id
            where ec.entity_id = e.id and (cg.id = p_category or cg.parent_id = p_category)))
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
revoke all on function public.search_entities(uuid, text, public.entity_type[], text, text, text, int, real, text, uuid, text, smallint, text, text) from public, anon;
grant execute on function public.search_entities(uuid, text, public.entity_type[], text, text, text, int, real, text, uuid, text, smallint, text, text) to authenticated;

-- Indicadores del resumen. Cada entidad cuenta una sola vez por indicador.
create or replace function public.dashboard_kpis(p_workspace uuid)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  with r as (
    select e.id,
           coalesce(x.buyer_potential, public.default_buyer(e.entity_type))   as bp,
           coalesce(x.seller_potential, public.default_seller(e.entity_type)) as sp,
           coalesce(x.buyer_participant, false)  as bpart,
           coalesce(x.seller_participant, false) as spart,
           exists (select 1 from contact_points cp where cp.entity_id = e.id) as has_contact,
           s.slug, coalesce(s.blocks_contact, false) as blocked, c.next_action_at
    from entities e
    left join entity_roles x on x.entity_id = e.id and x.workspace_id = p_workspace
    left join entity_crm c on c.entity_id = e.id and c.workspace_id = p_workspace
    left join crm_statuses s on s.id = c.status_id
    where e.merged_into is null and public.is_member(p_workspace)
  )
  select jsonb_build_object(
    'entities',             count(*),
    'buyers_potential',     count(*) filter (where bp and not bpart),
    'sellers_potential',    count(*) filter (where sp and not spart),
    'participants',         count(*) filter (where bpart or spart),
    'buyer_participants',   count(*) filter (where bpart),
    'seller_participants',  count(*) filter (where spart),
    'first_contact',        count(*) filter (where (bp or sp) and not (bpart or spart) and has_contact
                                               and (slug is null or slug in ('nuevo', 'pendiente'))
                                               and next_action_at is null and not blocked),
    'follow_ups',           count(*) filter (where next_action_at is not null and not blocked),
    'overdue',              count(*) filter (where next_action_at is not null and next_action_at < public.today_madrid() and not blocked),
    'pending',              count(*) filter (where not blocked and (next_action_at is not null or (
                                               (bp or sp) and not (bpart or spart) and has_contact
                                               and (slug is null or slug in ('nuevo', 'pendiente')))))
  )
  from r
$$;
revoke all on function public.dashboard_kpis(uuid) from public, anon;
grant execute on function public.dashboard_kpis(uuid) to authenticated;

-- Próximas acciones (pantalla Seguimiento y resumen).
create or replace view public.follow_ups
with (security_invoker = true) as
select c.workspace_id,
       e.id as entity_id,
       e.name,
       e.entity_type,
       e.municipality_code,
       aa.name as municipality_name,
       c.next_action,
       c.next_action_at,
       c.next_action_at < public.today_madrid() as overdue,
       c.priority,
       s.slug as crm_status,
       s.label as crm_status_label,
       coalesce(r.buyer_potential, public.default_buyer(e.entity_type)) or coalesce(r.buyer_participant, false)   as is_buyer,
       coalesce(r.seller_potential, public.default_seller(e.entity_type)) or coalesce(r.seller_participant, false) as is_seller,
       c.updated_at
from public.entity_crm c
join public.entities e on e.id = c.entity_id and e.merged_into is null
join public.crm_statuses s on s.id = c.status_id
left join public.entity_roles r on r.entity_id = e.id and r.workspace_id = c.workspace_id
left join public.admin_areas aa on aa.code = e.municipality_code
where c.next_action_at is not null and not s.blocks_contact;
grant select on public.follow_ups to authenticated;
revoke all on public.follow_ups from anon;

-- Mapa: se añade el filtro por rol comercial.
drop function public.map_features(uuid, float8, float8, float8, float8, int, public.entity_type[], text, text, int);
create function public.map_features(
  p_workspace   uuid,
  p_west        float8,
  p_south       float8,
  p_east        float8,
  p_north       float8,
  p_zoom        int,
  p_types       public.entity_type[] default null,
  p_category    text default null,
  p_crm_status  text default null,
  p_max_points  int default 1500,
  p_role        text default null
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
    left join entity_roles r on r.entity_id = e.id and r.workspace_id = p_workspace
    where e.merged_into is null and e.geom is not null
      and e.geom && st_makeenvelope(p_west, p_south, p_east, p_north, 4326)
      and (p_types is null or e.entity_type = any (p_types))
      and (p_category is null or exists (
            select 1 from entity_categories ec join categories cg on cg.id = ec.category_id
            where ec.entity_id = e.id and (cg.id = p_category or cg.parent_id = p_category)))
      and (p_crm_status is null or (case when p_crm_status = 'sin_estado' then s.slug is null else s.slug = p_crm_status end))
      and (p_role is null or case p_role
             when 'comprador_potencial'    then coalesce(r.buyer_potential, public.default_buyer(e.entity_type)) and not coalesce(r.buyer_participant, false)
             when 'vendedor_potencial'     then coalesce(r.seller_potential, public.default_seller(e.entity_type)) and not coalesce(r.seller_participant, false)
             when 'participante'           then coalesce(r.buyer_participant, false) or coalesce(r.seller_participant, false)
             when 'comprador_participante' then coalesce(r.buyer_participant, false)
             when 'vendedor_participante'  then coalesce(r.seller_participant, false)
             else false end)
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
revoke all on function public.map_features(uuid, float8, float8, float8, float8, int, public.entity_type[], text, text, int, text) from public, anon;
grant execute on function public.map_features(uuid, float8, float8, float8, float8, int, public.entity_type[], text, text, int, text) to authenticated;

-- Utilidades de solo lectura.
revoke all on function public.default_buyer(public.entity_type) from public, anon;
revoke all on function public.default_seller(public.entity_type) from public, anon;
revoke all on function public.today_madrid() from public, anon;
grant execute on function public.default_buyer(public.entity_type) to authenticated;
grant execute on function public.default_seller(public.entity_type) to authenticated;
grant execute on function public.today_madrid() to authenticated;

-- Fusiones: los roles comerciales se mueven y se restauran igual que el estado del CRM.
create or replace function public.merge_entities(p_survivor uuid, p_merged uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_records uuid[];
  v_values bigint[];
  v_contacts bigint[];
  v_identifiers jsonb;
  v_categories jsonb;
  v_notes uuid[];
  v_crm jsonb;
  v_roles jsonb;
  a uuid := least(p_survivor, p_merged);
  b uuid := greatest(p_survivor, p_merged);
begin
  perform public.assert_curator();
  if p_survivor = p_merged then
    raise exception 'No se puede fusionar una entidad consigo misma';
  end if;
  perform 1 from public.entities where id in (p_survivor, p_merged) for update;
  if (select count(*) from public.entities where id in (p_survivor, p_merged) and merged_into is null) <> 2 then
    raise exception 'Alguna de las entidades no existe o ya está fusionada';
  end if;
  if (select count(distinct entity_type) from public.entities where id in (p_survivor, p_merged)) <> 1 then
    raise exception 'No se pueden fusionar entidades de distinto tipo';
  end if;

  with m as (
    update public.entity_sources set entity_id = p_survivor
    where entity_id = p_merged returning source_record_id
  ) select coalesce(array_agg(source_record_id), '{}') into v_records from m;

  with m as (
    update public.field_values fv set entity_id = p_survivor, is_selected = false
    where fv.entity_id = p_merged
      and not exists (select 1 from public.field_values x where x.entity_id = p_survivor and x.field = fv.field
                      and x.source_id = fv.source_id and x.source_record_id is not distinct from fv.source_record_id)
    returning fv.id
  ) select coalesce(array_agg(id), '{}') into v_values from m;

  with m as (
    update public.contact_points cp set entity_id = p_survivor
    where cp.entity_id = p_merged
      and not exists (select 1 from public.contact_points x where x.entity_id = p_survivor and x.kind = cp.kind and x.normalized = cp.normalized)
    returning cp.id
  ) select coalesce(array_agg(id), '{}') into v_contacts from m;

  with m as (
    update public.entity_identifiers ei set entity_id = p_survivor
    where ei.entity_id = p_merged
      and not exists (select 1 from public.entity_identifiers x where x.entity_id = p_survivor and x.scheme = ei.scheme and x.value = ei.value)
    returning ei.scheme, ei.value
  ) select coalesce(jsonb_agg(jsonb_build_object('scheme', scheme, 'value', value)), '[]') into v_identifiers from m;

  with m as (
    update public.entity_categories ec set entity_id = p_survivor
    where ec.entity_id = p_merged
      and not exists (select 1 from public.entity_categories x where x.entity_id = p_survivor and x.category_id = ec.category_id and x.source_id = ec.source_id)
    returning ec.category_id, ec.source_id
  ) select coalesce(jsonb_agg(jsonb_build_object('category_id', category_id, 'source_id', source_id)), '[]') into v_categories from m;

  with m as (
    update public.entity_notes set entity_id = p_survivor where entity_id = p_merged returning id
  ) select coalesce(array_agg(id), '{}') into v_notes from m;

  -- CRM: si la superviviente no tiene estado en ese espacio, hereda el de la fusionada.
  with m as (
    update public.entity_crm c set entity_id = p_survivor
    where c.entity_id = p_merged
      and not exists (select 1 from public.entity_crm x where x.entity_id = p_survivor and x.workspace_id = c.workspace_id)
    returning c.workspace_id
  ) select coalesce(jsonb_agg(workspace_id), '[]') into v_crm from m;

  -- Roles comerciales: como el CRM, la superviviente hereda los de la fusionada si no tiene propios.
  with m as (
    update public.entity_roles x set entity_id = p_survivor
    where x.entity_id = p_merged
      and not exists (select 1 from public.entity_roles y where y.entity_id = p_survivor and y.workspace_id = x.workspace_id)
    returning x.workspace_id
  ) select coalesce(jsonb_agg(workspace_id), '[]') into v_roles from m;

  update public.entities set merged_into = p_survivor where id = p_merged;

  insert into public.merge_events (survivor_id, merged_id, moved, performed_by)
  values (p_survivor, p_merged, jsonb_build_object(
            'source_records', to_jsonb(v_records), 'field_values', to_jsonb(v_values),
            'contact_points', to_jsonb(v_contacts), 'identifiers', v_identifiers,
            'categories', v_categories, 'notes', to_jsonb(v_notes), 'crm_workspaces', v_crm,
            'role_workspaces', v_roles),
          auth.uid())
  returning id into v_event;

  update public.duplicate_candidates set status = 'same', reviewed_at = now(), reviewed_by = auth.uid()
  where entity_a = a and entity_b = b;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'entity.merge', 'entity', p_survivor::text, jsonb_build_object('merged_id', p_merged, 'merge_event', v_event));

  perform public.refresh_entity(p_survivor);
  return v_event;
end;
$$;

create or replace function public.revert_merge(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.merge_events;
  x jsonb;
begin
  perform public.assert_curator();
  select * into ev from public.merge_events where id = p_event for update;
  if not found or ev.reverted_at is not null then
    raise exception 'La fusión no existe o ya se deshizo';
  end if;

  update public.entity_sources set entity_id = ev.merged_id
    where source_record_id in (select (jsonb_array_elements_text(ev.moved -> 'source_records'))::uuid);
  update public.field_values set entity_id = ev.merged_id, is_selected = false
    where id in (select (jsonb_array_elements_text(ev.moved -> 'field_values'))::bigint);
  update public.contact_points set entity_id = ev.merged_id
    where id in (select (jsonb_array_elements_text(ev.moved -> 'contact_points'))::bigint);
  for x in select * from jsonb_array_elements(ev.moved -> 'identifiers') loop
    update public.entity_identifiers set entity_id = ev.merged_id
      where entity_id = ev.survivor_id and scheme = x ->> 'scheme' and value = x ->> 'value';
  end loop;
  for x in select * from jsonb_array_elements(ev.moved -> 'categories') loop
    update public.entity_categories set entity_id = ev.merged_id
      where entity_id = ev.survivor_id and category_id = x ->> 'category_id' and source_id = x ->> 'source_id';
  end loop;
  update public.entity_notes set entity_id = ev.merged_id
    where id in (select (jsonb_array_elements_text(ev.moved -> 'notes'))::uuid);
  update public.entity_crm set entity_id = ev.merged_id
    where entity_id = ev.survivor_id
      and workspace_id in (select (jsonb_array_elements_text(ev.moved -> 'crm_workspaces'))::uuid);
  update public.entity_roles set entity_id = ev.merged_id
    where entity_id = ev.survivor_id
      and workspace_id in (select (jsonb_array_elements_text(coalesce(ev.moved -> 'role_workspaces', '[]'::jsonb)))::uuid);

  update public.entities set merged_into = null where id = ev.merged_id;
  update public.merge_events set reverted_at = now(), reverted_by = auth.uid() where id = p_event;
  update public.duplicate_candidates set status = 'pending', reviewed_at = null, reviewed_by = null
    where entity_a = least(ev.survivor_id, ev.merged_id) and entity_b = greatest(ev.survivor_id, ev.merged_id);

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'entity.merge_revert', 'entity', ev.survivor_id::text, jsonb_build_object('merge_event', p_event));

  perform public.refresh_entity(ev.survivor_id);
  perform public.refresh_entity(ev.merged_id);
end;
$$;
