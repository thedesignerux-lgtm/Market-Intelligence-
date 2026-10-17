// Proceso worker de larga duración. Despliegue: un contenedor pequeño (ver docs/deploy.md).
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

console.log(`[worker] ${config.WORKER_ID} iniciado`);
while (!controller.signal.aborted) {
  try {
    await drainQueue(db, config, { signal: controller.signal });
  } catch (err) {
    console.error("[worker] error inesperado:", (err as Error).message);
  }
  if (!controller.signal.aborted) await new Promise((r) => setTimeout(r, config.POLL_INTERVAL_MS));
}
await db.end();
