// Bucle del worker: reclama tareas de la cola (tabla import_tasks), las ejecuta y gestiona reintentos.

import type { Config } from "./config";
import type { Db } from "./db";
import { Geocoder } from "./geocode";
import { backoffDelay } from "./http";
import { PermanentTaskError, runOsmTask, runRedTask, type ImportTask, type TaskStats } from "./handlers";

export async function executeTask(db: Db, config: Config, task: ImportTask, geocoder: Geocoder): Promise<void> {
  const source = task.task_key.split(":")[0];
  const started = Date.now();
  try {
    let stats: TaskStats;
    if (source === "red_galicia") stats = await runRedTask(db, config, task, geocoder);
    else if (source === "osm") stats = await runOsmTask(db, config, task);
    else throw new PermanentTaskError(`Fuente desconocida en la tarea: ${source}`);

    stats.duration_ms = Date.now() - started;
    await db.query(
      `update public.import_tasks set status = 'succeeded', stats = $2, finished_at = now(), last_error = null,
              locked_by = null, locked_at = null where id = $1`,
      [task.id, JSON.stringify(stats)],
    );
    console.log(`[worker] ✔ ${task.task_key} ${JSON.stringify(stats)}`);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const permanent = err instanceof PermanentTaskError;
    const exhausted = task.attempts >= task.max_attempts;
    if (permanent || exhausted) {
      await db.query(
        `update public.import_tasks set status = 'failed', last_error = $2, finished_at = now(),
                locked_by = null, locked_at = null where id = $1`,
        [task.id, message.slice(0, 2000)],
      );
      console.error(`[worker] ✖ ${task.task_key} (definitivo): ${message}`);
    } else {
      const delay = backoffDelay(task.attempts, 30_000);
      await db.query(
        `update public.import_tasks set status = 'queued', last_error = $2, locked_by = null, locked_at = null,
                next_attempt_at = now() + make_interval(secs => $3) where id = $1`,
        [task.id, message.slice(0, 2000), delay / 1000],
      );
      console.warn(`[worker] ↻ ${task.task_key} reintento ${task.attempts}/${task.max_attempts} en ${Math.round(delay / 1000)} s: ${message}`);
    }
  } finally {
    await db.query("select public.refresh_import_run($1)", [task.run_id]);
  }
}

export async function claimTask(db: Db, workerId: string): Promise<ImportTask | null> {
  const { rows } = await db.query<ImportTask>("select * from public.claim_import_task($1)", [workerId]);
  return rows[0] ?? null;
}

/** Procesa tareas hasta que no quede ninguna lista (o hasta stop()). */
export async function drainQueue(db: Db, config: Config, opts: { runId?: string; signal?: AbortSignal } = {}) {
  const geocoder = new Geocoder(db, config);
  await db.query("select public.requeue_stale_tasks()");
  for (;;) {
    if (opts.signal?.aborted) return geocoder.stats;
    const task = await claimTask(db, config.WORKER_ID);
    if (!task) return geocoder.stats;
    if (opts.runId && task.run_id !== opts.runId) {
      // Modo CLI: devuelve a la cola las tareas de otras importaciones.
      await db.query("update public.import_tasks set status = 'queued', attempts = attempts - 1, locked_by = null, locked_at = null where id = $1", [task.id]);
      return geocoder.stats;
    }
    await executeTask(db, config, task, geocoder);
  }
}
