-- 0010 · Endurecer permisos de funciones (resultado del asesor de seguridad de Supabase)
--
-- Las funciones de trigger y las auxiliares internas no deben poder invocarse desde la API.
-- PostgreSQL concede EXECUTE a PUBLIC por defecto, así que se retira de PUBLIC, anon y authenticated.
-- Siguen funcionando porque los triggers y las funciones SECURITY DEFINER las ejecutan como propietario.

revoke all on function public.seed_crm_statuses()     from public, anon, authenticated;
revoke all on function public.entity_crm_history()    from public, anon, authenticated;
revoke all on function public.entity_notes_history()  from public, anon, authenticated;
revoke all on function public.memberships_audit()     from public, anon, authenticated;
revoke all on function public.entity_crm_guard()      from public, anon, authenticated;
revoke all on function public.set_updated_at()        from public, anon, authenticated;
revoke all on function public.assert_curator()        from public, anon, authenticated;

-- Notas sobre los avisos restantes (intencionados):
-- · has_role / is_member / has_role_anywhere: las políticas RLS las evalúan con el usuario que consulta,
--   por eso authenticated necesita EXECUTE. Solo revelan los permisos del propio usuario.
-- · merge_entities, revert_merge, mark_not_duplicate, request_import, control_import: son la API
--   controlada para estas acciones y comprueban el rol (admin/editor) dentro de la función.
-- · geocode_cache: RLS activo sin políticas a propósito; solo la usa el worker (rol de servidor).
