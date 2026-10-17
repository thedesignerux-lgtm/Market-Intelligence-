-- 0007 · Fusión y revisión de duplicados (auditable y reversible)

-- Permite la operación si la ejecuta el sistema (worker con service_role/postgres, sin usuario)
-- o un usuario con rol admin/editor.
create or replace function public.assert_curator()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.has_role_anywhere(array['admin', 'editor']::public.app_role[]) then
    raise exception 'Permiso denegado: se requiere rol admin o editor' using errcode = '42501';
  end if;
end;
$$;

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

  update public.entities set merged_into = p_survivor where id = p_merged;

  insert into public.merge_events (survivor_id, merged_id, moved, performed_by)
  values (p_survivor, p_merged, jsonb_build_object(
            'source_records', to_jsonb(v_records), 'field_values', to_jsonb(v_values),
            'contact_points', to_jsonb(v_contacts), 'identifiers', v_identifiers,
            'categories', v_categories, 'notes', to_jsonb(v_notes), 'crm_workspaces', v_crm),
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

-- Marcar un par como "distintos" (no volver a proponerlo).
create or replace function public.mark_not_duplicate(p_candidate bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_curator();
  update public.duplicate_candidates set status = 'different', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_candidate and status = 'pending';
  if not found then
    raise exception 'El candidato no existe o ya fue revisado';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id)
  values (auth.uid(), 'duplicate.mark_different', 'duplicate_candidate', p_candidate::text);
end;
$$;

revoke all on function public.merge_entities(uuid, uuid) from public, anon;
revoke all on function public.revert_merge(uuid) from public, anon;
revoke all on function public.mark_not_duplicate(bigint) from public, anon;
revoke all on function public.assert_curator() from public, anon;
grant execute on function public.merge_entities(uuid, uuid) to authenticated;
grant execute on function public.revert_merge(uuid) to authenticated;
grant execute on function public.mark_not_duplicate(bigint) to authenticated;
