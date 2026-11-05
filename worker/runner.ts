// Bucle del worker: reclama tareas de la cola (tabla import_tasks), las ejecuta y gestiona reintentos.

import type { Config } from "./config";
import type { Db } from "./db";
import { Geocoder } from "./geocode";
import { backoffDelay, HttpError } from "./http";
import { PermanentTaskError, runOsmTask, runRedTask, runRegistryTask, type ImportTask, type TaskStats } from "./handlers";
import { REGISTRIES } from "./sources/registries";

/** Resultado de una tarea, para que el bucle sepa si la fuente está caída. */
export interface TaskOutcome {
  ok: boolean;
  /** La tarea falló por no poder hablar con el servidor de la fuente (no por los datos). */
  sourceUnreachable: boolean;
}

export async function executeTask(db: Db, config: Config, task: ImportTask, geocoder: Geocoder): Promise<TaskOutcome> {
  const source = task.task_key.split(":")[0];
  const started = Date.now();
  try {
    let stats: TaskStats;
    if (source === "red_galicia") stats = await runRedTask(db, config, task, geocoder);
    else if (source === "osm") stats = await runOsmTask(db, config, task);
    else if (source && REGISTRIES[source]) stats = await runRegistryTask(db, config, task, geocoder, REGISTRIES[source]);
    else throw new PermanentTaskError(`Fuente desconocida en la tarea: ${source}`);

    stats.duration_ms = Date.now() - started;
    await db.query(
      `update public.import_tasks set status = 'succeeded', stats = $2, finished_at = now(), last_error = null,
              locked_by = null, locked_at = null where id = $1`,
      [task.id, JSON.stringify(stats)],
    );
    console.log(`[worker] ✔ ${task.task_key} ${JSON.stringify(stats)}`);
    return { ok: true, sourceUnreachable: false };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const permanent = err instanceof PermanentTaskError;
    // Error de red: no hubo respuesta del servidor (status null), frente a un error en los datos.
    const sourceUnreachable = err instanceof HttpError && err.status === null;
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
    return { ok: false, sourceUnreachable };
  } finally {
    await db.query("select public.refresh_import_run($1)", [task.run_id]);
  }
}

/**
 * Cortacircuitos: si una fuente deja de responder, cancela la importación en lugar de
 * reintentar noche tras noche. Sin esto, una fuente caída deja la importación en «running»
 * indefinidamente, bloquea otra importación del mismo alcance (import_runs_one_active_idx)
 * y consume la ventana del workflow nocturno sin avanzar.
 */
export const SOURCE_DOWN_THRESHOLD = 12;

async function tripCircuitBreaker(db: Db, runId: string, source: string, failures: number): Promise<void> {
  await db.query(
    `insert into public.import_issues (run_id, severity, code, message) values ($1, 'error', 'source_unreachable', $2)`,
    [runId, `La fuente «${source}» no responde: ${failures} tareas seguidas sin respuesta del servidor. Importación cancelada para no reintentar indefinidamente.`],
  );
  await db.query("select public.control_import($1, 'cancel')", [runId]);
  console.error(`[worker] ⛔ fuente «${source}» caída (${failures} fallos seguidos). Importación ${runId} cancelada.`);
}

export async function claimTask(db: Db, workerId: string): Promise<ImportTask | null> {
  const { rows } = await db.query<ImportTask>("select * from public.claim_import_task($1)", [workerId]);
  return rows[0] ?? null;
}

/** Procesa tareas hasta que no quede ninguna lista (o hasta stop()). */
export async function drainQueue(db: Db, config: Config, opts: { runId?: string; signal?: AbortSignal } = {}) {
  const geocoder = new Geocoder(db, config);
  await db.query("select public.requeue_stale_tasks()");
  // Fallos de red seguidos por fuente, para el cortacircuitos.
  const unreachable = new Map<string, number>();
  for (;;) {
    if (opts.signal?.aborted) return geocoder.stats;
    const task = await claimTask(db, config.WORKER_ID);
    if (!task) return geocoder.stats;
    if (opts.runId && task.run_id !== opts.runId) {
      // Modo CLI: devuelve a la cola las tareas de otras importaciones.
      await db.query("update public.import_tasks set status = 'queued', attempts = attempts - 1, locked_by = null, locked_at = null where id = $1", [task.id]);
      return geocoder.stats;
    }
    const source = task.task_key.split(":")[0] ?? "desconocida";
    const outcome = await executeTask(db, config, task, geocoder);
    const failures = outcome.sourceUnreachable ? (unreachable.get(source) ?? 0) + 1 : 0;
    unreachable.set(source, failures);
    if (failures >= SOURCE_DOWN_THRESHOLD) {
      await tripCircuitBreaker(db, task.run_id, source, failures);
      unreachable.set(source, 0);
    }
  }
}
