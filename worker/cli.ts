// Uso: npm run import -- <fuente> <ámbito> [ámbito...]
// Ámbito: código INE de municipio (15078), código de provincia (15) o «galicia» (las cuatro provincias).
// Ejemplos:
//   npm run import -- red_galicia 15078
//   npm run import -- osm galicia
// Solicita la importación (igual que la aplicación) y la ejecuta en este proceso.
import { loadConfig } from "./config";
import { createPool } from "./db";
import { provinceMunicipalityCodes } from "./handlers";
import { drainQueue } from "./runner";

const GALICIA = ["15", "27", "32", "36"];

const [source, ...scopes] = process.argv.slice(2);
if (!source || scopes.length === 0) {
  console.error("Uso: npm run import -- <osm|red_galicia> <municipio INE | provincia | galicia> [...]");
  process.exit(2);
}

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
try {
  const municipalities = new Set<string>();
  for (const scope of scopes) {
    const provinces = scope.toLowerCase() === "galicia" ? GALICIA : /^\d{2}$/.test(scope) ? [scope] : null;
    if (provinces) {
      for (const p of provinces) for (const code of await provinceMunicipalityCodes(db, config, p)) municipalities.add(code);
    } else if (/^\d{5}$/.test(scope)) {
      municipalities.add(scope);
    } else {
      throw new Error(`Ámbito no válido: ${scope}`);
    }
  }
  const list = [...municipalities].sort();
  const { rows } = await db.query<{ id: string }>("select public.request_import($1, $2) as id", [source, list]);
  const runId = rows[0]!.id;
  console.log(`Importación ${runId} solicitada (${source} · ${list.length} municipios)`);
  const geo = await drainQueue(db, config, { runId });
  const run = await db.query("select status, source_version, stats from public.import_runs where id = $1", [runId]);
  console.log("Resultado:", JSON.stringify(run.rows[0], null, 2));
  console.log("Geocodificador:", JSON.stringify(geo));
} finally {
  await db.end();
}
