-- 0006 · CRM mínimo (estado, responsable, notas, historial) y auditoría
--
-- Los datos comerciales pertenecen a un espacio de trabajo. La misma entidad puede estar
-- en estados distintos en espacios distintos.

create table public.crm_statuses (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  slug            text not null check (slug ~ '^[a-z0-9_]{2,40}$'),
  label           text not null,
  sort            int not null default 100,
  is_terminal     boolean not null default false,
  -- "No contactar": bloquea acciones comerciales posteriores.
  blocks_contact  boolean not null default false,
  unique (workspace_id, slug)
);

create table public.entity_crm (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  entity_id     uuid not null references public.entities(id) on delete cascade,
  status_id     uuid not null references public.crm_statuses(id),
  owner_id      uuid references auth.users(id),
  priority      smallint check (priority between 1 and 3),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  primary key (workspace_id, entity_id)
);
create index entity_crm_status_idx on public.entity_crm (workspace_id, status_id);

create table public.entity_notes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  entity_id     uuid not null references public.entities(id) on delete cascade,
  author_id     uuid references auth.users(id) default auth.uid(),
  body          text not null check (char_length(btrim(body)) between 1 and 10000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index entity_notes_entity_idx on public.entity_notes (workspace_id, entity_id, created_at desc);
create trigger entity_notes_updated_at before update on public.entity_notes
  for each row execute function public.set_updated_at();

-- Historial comercial (alimentado por triggers, no editable).
create table public.crm_events (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  entity_id     uuid not null references public.entities(id) on delete cascade,
  actor_id      uuid references auth.users(id),
  kind          text not null check (kind in ('status_changed', 'owner_changed', 'priority_changed', 'note_added', 'note_deleted')),
  from_value    jsonb,
  to_value      jsonb,
  created_at    timestamptz not null default now()
);
create index crm_events_entity_idx on public.crm_events (workspace_id, entity_id, created_at desc);

-- Auditoría de acciones sensibles.
create table public.audit_log (
  id            bigint generated always as identity primary key,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  actor_id      uuid references auth.users(id) on delete set null,
  action        text not null,
  target_type   text not null,
  target_id     text,
  details       jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (workspace_id, created_at desc);

-- Estados por defecto al crear un espacio de trabajo.
create or replace function public.seed_crm_statuses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.crm_statuses (workspace_id, slug, label, sort, is_terminal, blocks_contact) values
    (new.id, 'nuevo',          'Nuevo',          10, false, false),
    (new.id, 'pendiente',      'Pendiente',      20, false, false),
    (new.id, 'contactado',     'Contactado',     30, false, false),
    (new.id, 'respondio',      'Respondió',      40, false, false),
    (new.id, 'interesado',     'Interesado',     50, false, false),
    (new.id, 'negociacion',    'Negociación',    60, false, false),
    (new.id, 'cliente',        'Cliente',        70, true,  false),
    (new.id, 'no_interesado',  'No interesado',  80, true,  false),
    (new.id, 'no_contactar',   'No contactar',   90, true,  true);
  return new;
end;
$$;
create trigger workspaces_seed_statuses after insert on public.workspaces
  for each row execute function public.seed_crm_statuses();

-- El estado debe pertenecer al mismo espacio de trabajo.
create or replace function public.entity_crm_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.crm_statuses s where s.id = new.status_id and s.workspace_id = new.workspace_id) then
    raise exception 'El estado no pertenece a este espacio de trabajo' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
create trigger entity_crm_guard before insert or update on public.entity_crm
  for each row execute function public.entity_crm_guard();

-- Historial automático de cambios comerciales.
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
  return new;
end;
$$;
create trigger entity_crm_history after insert or update on public.entity_crm
  for each row execute function public.entity_crm_history();

create or replace function public.entity_notes_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_events (workspace_id, entity_id, actor_id, kind, to_value)
    values (new.workspace_id, new.entity_id, auth.uid(), 'note_added', jsonb_build_object('note_id', new.id));
    return new;
  else
    insert into public.crm_events (workspace_id, entity_id, actor_id, kind, from_value)
    values (old.workspace_id, old.entity_id, auth.uid(), 'note_deleted', jsonb_build_object('note_id', old.id));
    insert into public.audit_log (workspace_id, actor_id, action, target_type, target_id)
    values (old.workspace_id, auth.uid(), 'note.delete', 'entity_note', old.id::text);
    return old;
  end if;
end;
$$;
create trigger entity_notes_history after insert or delete on public.entity_notes
  for each row execute function public.entity_notes_history();

-- Auditoría de cambios de permisos.
create or replace function public.memberships_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (workspace_id, actor_id, action, target_type, target_id, details)
  values (coalesce(new.workspace_id, old.workspace_id), auth.uid(), 'membership.' || lower(tg_op), 'user',
          coalesce(new.user_id, old.user_id)::text,
          jsonb_build_object('from', case when tg_op <> 'INSERT' then old.role end,
                             'to', case when tg_op <> 'DELETE' then new.role end));
  return coalesce(new, old);
end;
$$;
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function public.memberships_audit();

-- ¿Se puede contactar comercialmente a esta entidad en este espacio?
-- Los futuros flujos de envío deberán comprobarlo antes de actuar.
create or replace function public.can_contact(p_workspace uuid, p_entity uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.entity_crm c join public.crm_statuses s on s.id = c.status_id
    where c.workspace_id = p_workspace and c.entity_id = p_entity and s.blocks_contact
  )
$$;
