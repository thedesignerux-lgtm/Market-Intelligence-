-- 0005 · Posibles duplicados, fusiones e importaciones persistentes

create type public.duplicate_status as enum ('pending', 'same', 'different');

-- Pares de entidades que podrían ser la misma. Nunca se fusionan solos si son ambiguos.
create table public.duplicate_candidates (
  id           bigint generated always as identity primary key,
  entity_a     uuid not null references public.entities(id) on delete cascade,
  entity_b     uuid not null references public.entities(id) on delete cascade,
  score        numeric(4,3) not null check (score between 0 and 1),
  -- Señales que justifican la puntuación (distancia, similitud de nombre, teléfono...).
  signals      jsonb not null default '{}',
  status       public.duplicate_status not null default 'pending',
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users(id),
  check (entity_a < entity_b),
  unique (entity_a, entity_b)
);
create index duplicate_candidates_pending_idx on public.duplicate_candidates (score desc) where status = 'pending';

-- Fusiones auditables y reversibles: se guarda exactamente qué se movió.
create table public.merge_events (
  id            uuid primary key default gen_random_uuid(),
  survivor_id   uuid not null references public.entities(id),
  merged_id     uuid not null references public.entities(id),
  moved         jsonb not null,
  performed_by  uuid references auth.users(id),
  performed_at  timestamptz not null default now(),
  reverted_at   timestamptz,
  reverted_by   uuid references auth.users(id)
);
create index merge_events_entities_idx on public.merge_events (survivor_id, merged_id);

-- Importaciones ---------------------------------------------------------------

create type public.run_status as enum ('queued', 'running', 'paused', 'succeeded', 'partial', 'failed', 'cancelled');
create type public.task_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- Una importación solicitada (p. ej. "OSM · ciclismo · Santiago de Compostela").
create table public.import_runs (
  id             uuid primary key default gen_random_uuid(),
  source_id      text not null references public.sources(id),
  -- Alcance: {"municipalities": ["15078"], "categories": ["club.deportivo.ciclismo"]}
  scope          jsonb not null check (jsonb_typeof(scope) = 'object'),
  status         public.run_status not null default 'queued',
  requested_by   uuid references auth.users(id),
  -- Versión de los datos de origen (fecha del extracto OSM, fecha del CSV...).
  source_version text,
  stats          jsonb not null default '{}',
  error          text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
-- Evita trabajos duplicados: no puede haber dos importaciones activas con la misma fuente y alcance.
create unique index import_runs_one_active_idx on public.import_runs (source_id, (scope::text))
  where status in ('queued', 'running', 'paused');
create index import_runs_created_idx on public.import_runs (created_at desc);

-- Tareas en que se trocea una importación (una por municipio y fuente).
-- Esta tabla es también la cola del worker (ver ADR-0005): se reclaman con SKIP LOCKED.
create table public.import_tasks (
  id               bigint generated always as identity primary key,
  run_id           uuid not null references public.import_runs(id) on delete cascade,
  task_key         text not null,
  params           jsonb not null default '{}',
  status           public.task_status not null default 'queued',
  attempts         int not null default 0,
  max_attempts     int not null default 5,
  next_attempt_at  timestamptz not null default now(),
  locked_by        text,
  locked_at        timestamptz,
  last_error       text,
  stats            jsonb not null default '{}',
  started_at       timestamptz,
  finished_at      timestamptz,
  unique (run_id, task_key)
);
create index import_tasks_claim_idx on public.import_tasks (next_attempt_at, id) where status = 'queued';

-- Registros dudosos o con problemas detectados durante la importación.
create table public.import_issues (
  id               bigint generated always as identity primary key,
  run_id           uuid not null references public.import_runs(id) on delete cascade,
  task_id          bigint references public.import_tasks(id) on delete cascade,
  source_record_id uuid references public.source_records(id) on delete set null,
  severity         text not null check (severity in ('info', 'warning', 'error')),
  code             text not null,
  message          text not null,
  created_at       timestamptz not null default now()
);
create index import_issues_run_idx on public.import_issues (run_id, severity);

-- El worker reclama la siguiente tarea disponible sin que dos workers cojan la misma.
create or replace function public.claim_import_task(p_worker text)
returns setof public.import_tasks
language sql
set search_path = ''
as $$
  update public.import_tasks t
     set status = 'running', locked_by = p_worker, locked_at = now(),
         attempts = t.attempts + 1, started_at = coalesce(t.started_at, now())
   where t.id = (
     select it.id from public.import_tasks it
     join public.import_runs r on r.id = it.run_id
     where it.status = 'queued' and it.next_attempt_at <= now() and r.status in ('queued', 'running')
     order by it.next_attempt_at, it.id
     for update of it skip locked
     limit 1
   )
  returning t.*;
$$;

-- Recupera tareas que quedaron "running" porque un worker murió.
create or replace function public.requeue_stale_tasks(p_older_than interval default interval '15 minutes')
returns int
language sql
set search_path = ''
as $$
  with upd as (
    update public.import_tasks
       set status = 'queued', locked_by = null, locked_at = null, next_attempt_at = now()
     where status = 'running' and locked_at < now() - p_older_than
    returning 1
  ) select count(*)::int from upd;
$$;

-- Recalcula el estado de una importación a partir de sus tareas.
create or replace function public.refresh_import_run(p_run_id uuid)
returns public.run_status
language plpgsql
set search_path = ''
as $$
declare
  c record;
  new_status public.run_status;
  cur public.run_status;
begin
  select status into cur from public.import_runs where id = p_run_id for update;
  if cur in ('paused', 'cancelled') then
    return cur;
  end if;

  select count(*) filter (where status in ('queued', 'running')) as open,
         count(*) filter (where status = 'succeeded') as ok,
         count(*) filter (where status = 'failed') as ko,
         count(*) as total
    into c from public.import_tasks where run_id = p_run_id;

  new_status := case
    when c.total = 0 then cur
    when c.open > 0 then 'running'
    when c.ko = 0 then 'succeeded'
    when c.ok = 0 then 'failed'
    else 'partial' end;

  update public.import_runs set
    status = new_status,
    started_at = coalesce(started_at, case when new_status <> 'queued' then now() end),
    finished_at = case when new_status in ('succeeded', 'failed', 'partial') then now() else null end,
    stats = (select coalesce(jsonb_object_agg(k, v), '{}') from (
               select key as k, sum(value::numeric) as v
               from public.import_tasks t, jsonb_each_text(t.stats)
               where t.run_id = p_run_id and value ~ '^[0-9]+$'
               group by key) s)
            || jsonb_build_object('tasks_total', c.total, 'tasks_ok', c.ok, 'tasks_failed', c.ko)
  where id = p_run_id;
  return new_status;
end;
$$;
