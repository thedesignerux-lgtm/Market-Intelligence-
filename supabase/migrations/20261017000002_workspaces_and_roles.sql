-- 0002 · Espacios de trabajo, roles y funciones de autorización
--
-- Decisión (ADR-0003): la herramienta es interna, pero los datos comerciales (CRM)
-- se separan por espacio de trabajo desde el día 1. Los datos de conocimiento
-- (entidades y fuentes) son compartidos y de solo lectura para los miembros.

create type public.app_role as enum ('admin', 'editor', 'comercial', 'lector');

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at  timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         public.app_role not null default 'lector',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- ¿El usuario actual tiene alguno de estos roles en este espacio?
-- SECURITY DEFINER para que las políticas RLS puedan consultarlo sin recursión.
create or replace function public.has_role(ws uuid, roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  )
$$;

create or replace function public.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  )
$$;

-- ¿Tiene el usuario alguno de estos roles en cualquier espacio?
-- Se usa para la capa de conocimiento compartida (p. ej. revisar duplicados).
create or replace function public.has_role_anywhere(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.role = any (roles)
  )
$$;

revoke all on function public.has_role(uuid, public.app_role[]) from public, anon;
revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.has_role_anywhere(public.app_role[]) from public, anon;
grant execute on function public.has_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role_anywhere(public.app_role[]) to authenticated;
