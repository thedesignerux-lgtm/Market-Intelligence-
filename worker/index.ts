// Importador (worker).
// · Sin argumentos: proceso de larga duración que atiende la cola continuamente.
// · Con --once: procesa todo lo que haya en la cola y termina (lo usa GitHub Actions).
import { loadConfig } from "./config";
import { createPool } from "./db";
import { drainQueue } from "./runner";

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const controller = new AbortController();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} recibido: termino la tarea en curso y salgo`);
    controller.abort();
  });
}

const once = process.argv.includes("--once");
console.log(`[worker] ${config.WORKER_ID} iniciado${once ? " (una pasada)" : ""}`);
if (once) {
  const stats = await drainQueue(db, config, { signal: controller.signal });
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.import_tasks where status in ('queued', 'running')");
  console.log(`[worker] cola procesada. Geocodificador: ${JSON.stringify(stats)}. Tareas pendientes: ${rows[0]?.n ?? 0}`);
  await db.end();
  process.exit(0);
}
while (!controller.signal.aborted) {
  try {
    await drainQueue(db, config, { signal: controller.signal });
  } catch (err) {
    console.error("[worker] error inesperado:", (err as Error).message);
  }
  if (!controller.signal.aborted) await new Promise((r) => setTimeout(r, config.POLL_INTERVAL_MS));
}
await db.end();
