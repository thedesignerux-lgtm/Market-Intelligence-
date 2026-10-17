-- 0009 · Seguridad por filas (RLS) y permisos
--
-- Reglas:
-- · Nadie anónimo ve nada.
-- · La capa de conocimiento (entidades, fuentes, importaciones) la leen los miembros de cualquier
--   espacio. Solo el worker (service_role, que salta RLS) o funciones controladas la modifican.
-- · La capa comercial (CRM) solo la ven los miembros de su espacio; la editan admin/editor/comercial.
-- · "lector" solo lee.

-- Defensa en profundidad: anon no tiene privilegios sobre ninguna tabla.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces', 'memberships', 'sources', 'admin_areas', 'categories', 'category_mappings',
    'entities', 'entity_categories', 'source_records', 'entity_sources', 'entity_identifiers',
    'field_values', 'contact_points', 'geocode_cache', 'duplicate_candidates', 'merge_events',
    'import_runs', 'import_tasks', 'import_issues', 'crm_statuses', 'entity_crm', 'entity_notes',
    'crm_events', 'audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Capa de conocimiento: solo lectura para miembros; sin escritura directa.
do $$
declare t text;
begin
  foreach t in array array[
    'sources', 'admin_areas', 'categories', 'category_mappings', 'entities', 'entity_categories',
    'source_records', 'entity_sources', 'entity_identifiers', 'field_values', 'contact_points',
    'duplicate_candidates', 'merge_events', 'import_runs', 'import_tasks', 'import_issues']
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_role_anywhere(array[''admin'',''editor'',''comercial'',''lector'']::public.app_role[]))',
      t || '_read_members', t);
  end loop;
end $$;

-- La caché de geocodificación es interna del worker.
revoke all on public.geocode_cache from authenticated;

-- Espacios y membresías
create policy workspaces_read on public.workspaces for select to authenticated
  using (public.is_member(id));
create policy workspaces_admin_update on public.workspaces for update to authenticated
  using (public.has_role(id, array['admin']::public.app_role[]))
  with check (public.has_role(id, array['admin']::public.app_role[]));
grant update (name) on public.workspaces to authenticated;

create policy memberships_read on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role(workspace_id, array['admin']::public.app_role[]));
create policy memberships_admin_insert on public.memberships for insert to authenticated
  with check (public.has_role(workspace_id, array['admin']::public.app_role[]));
create policy memberships_admin_update on public.memberships for update to authenticated
  using (public.has_role(workspace_id, array['admin']::public.app_role[]))
  with check (public.has_role(workspace_id, array['admin']::public.app_role[]));
create policy memberships_admin_delete on public.memberships for delete to authenticated
  using (public.has_role(workspace_id, array['admin']::public.app_role[]) and user_id <> (select auth.uid()));
grant insert, update (role), delete on public.memberships to authenticated;

-- CRM
create policy crm_statuses_read on public.crm_statuses for select to authenticated
  using (public.is_member(workspace_id));
create policy crm_statuses_admin_write on public.crm_statuses for all to authenticated
  using (public.has_role(workspace_id, array['admin']::public.app_role[]))
  with check (public.has_role(workspace_id, array['admin']::public.app_role[]));
grant insert, update, delete on public.crm_statuses to authenticated;

create policy entity_crm_read on public.entity_crm for select to authenticated
  using (public.is_member(workspace_id));
create policy entity_crm_insert on public.entity_crm for insert to authenticated
  with check (public.has_role(workspace_id, array['admin', 'editor', 'comercial']::public.app_role[]));
create policy entity_crm_update on public.entity_crm for update to authenticated
  using (public.has_role(workspace_id, array['admin', 'editor', 'comercial']::public.app_role[]))
  with check (public.has_role(workspace_id, array['admin', 'editor', 'comercial']::public.app_role[]));
create policy entity_crm_delete on public.entity_crm for delete to authenticated
  using (public.has_role(workspace_id, array['admin', 'editor']::public.app_role[]));
grant insert, update (status_id, owner_id, priority), delete on public.entity_crm to authenticated;

create policy entity_notes_read on public.entity_notes for select to authenticated
  using (public.is_member(workspace_id));
create policy entity_notes_insert on public.entity_notes for insert to authenticated
  with check (author_id = (select auth.uid())
              and public.has_role(workspace_id, array['admin', 'editor', 'comercial']::public.app_role[]));
create policy entity_notes_update_own on public.entity_notes for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy entity_notes_delete on public.entity_notes for delete to authenticated
  using (author_id = (select auth.uid()) or public.has_role(workspace_id, array['admin']::public.app_role[]));
grant insert (workspace_id, entity_id, body), update (body), delete on public.entity_notes to authenticated;

create policy crm_events_read on public.crm_events for select to authenticated
  using (public.is_member(workspace_id));
revoke insert, update, delete, truncate on public.crm_events from authenticated;

-- Auditoría: solo administradores.
create policy audit_log_admin_read on public.audit_log for select to authenticated
  using (case when workspace_id is null
              then public.has_role_anywhere(array['admin']::public.app_role[])
              else public.has_role(workspace_id, array['admin']::public.app_role[]) end);
revoke insert, update, delete, truncate on public.audit_log from authenticated;

-- Funciones de lectura disponibles para usuarios autenticados.
grant execute on function public.search_entities(uuid, text, public.entity_type[], text, text, text, int, real, text, uuid) to authenticated;
grant execute on function public.map_features(uuid, float8, float8, float8, float8, int, public.entity_type[], text, text, int) to authenticated;
grant execute on function public.can_contact(uuid, uuid) to authenticated;
grant select on public.coverage_by_municipality to authenticated;
-- Utilidades de texto (usadas por columnas generadas y búsqueda).
grant execute on function public.search_normalize(text) to authenticated;
grant execute on function public.immutable_unaccent(text) to authenticated;

-- Funciones internas del worker: no accesibles desde la API.
revoke all on function public.claim_import_task(text) from public, authenticated;
revoke all on function public.requeue_stale_tasks(interval) from public, authenticated;
revoke all on function public.refresh_import_run(uuid) from public, authenticated;
revoke all on function public.refresh_entity(uuid) from public, authenticated;
