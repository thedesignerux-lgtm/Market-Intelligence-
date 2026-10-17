// Uso: npm run import -- <fuente> <municipio> [municipio...]
// Ejemplo: npm run import -- red_galicia 15078
// Solicita la importación (igual que la aplicación) y la ejecuta en este proceso.
import { loadConfig } from "./config";
import { createPool } from "./db";
import { drainQueue } from "./runner";

const [source, ...municipalities] = process.argv.slice(2);
if (!source || municipalities.length === 0) {
  console.error("Uso: npm run import -- <osm|red_galicia> <código INE municipio> [...]");
  process.exit(2);
}

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
try {
  const { rows } = await db.query<{ id: string }>("select public.request_import($1, $2) as id", [source, municipalities]);
  const runId = rows[0]!.id;
  console.log(`Importación ${runId} solicitada (${source} · ${municipalities.join(", ")})`);
  const geo = await drainQueue(db, config, { runId });
  const run = await db.query("select status, source_version, stats from public.import_runs where id = $1", [runId]);
  console.log("Resultado:", JSON.stringify(run.rows[0], null, 2));
  console.log("Geocodificador:", JSON.stringify(geo));
} finally {
  await db.end();
}
