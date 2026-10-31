// Uso: npm run import -- <fuente> <ámbito> [ámbito...]
// Ámbito: código INE de municipio (15078), código de provincia (15), una comunidad
// (galicia, andalucia, madrid… ver src/lib/domain/territory.ts) o «espana» (las 52 provincias).
// Ejemplos:
//   npm run import -- red_galicia 15078
//   npm run import -- osm galicia
//   npm run import -- osm espana
// Solicita una importación por provincia (como la aplicación) y procesa la cola en este proceso.
// Si el proceso se corta, las tareas pendientes se retoman en la siguiente ejecución del worker.
import { loadConfig } from "./config";
import { createPool } from "./db";
import { provinceMunicipalityCodes } from "./handlers";
import { drainQueue } from "./runner";
import { provincesForScope } from "../src/lib/domain/territory";

const [source, ...scopes] = process.argv.slice(2);
if (!source || scopes.length === 0) {
  console.error("Uso: npm run import -- <osm|red_galicia> <municipio INE | provincia | comunidad | espana> [...]");
  process.exit(2);
}

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
try {
  // Municipios agrupados por provincia: una importación por provincia (máximo 400 municipios cada una).
  const byProvince = new Map<string, Set<string>>();
  const add = (code: string) => {
    const p = code.slice(0, 2);
    if (!byProvince.has(p)) byProvince.set(p, new Set());
    byProvince.get(p)!.add(code);
  };
  for (const scope of scopes) {
    const provinces = provincesForScope(scope);
    if (provinces) {
      for (const p of provinces) {
        try {
          for (const code of await provinceMunicipalityCodes(db, config, p)) add(code);
        } catch (err) {
          console.error(`Provincia ${p}: no se pudieron cargar sus municipios (${(err as Error).message}). Se omite.`);
        }
      }
    } else if (/^\d{5}$/.test(scope)) {
      add(scope);
    } else {
      throw new Error(`Ámbito no válido: ${scope}`);
    }
  }

  const runIds: string[] = [];
  for (const [province, set] of [...byProvince.entries()].sort()) {
    const list = [...set].sort();
    try {
      const { rows } = await db.query<{ id: string }>("select public.request_import($1, $2) as id", [source, list]);
      runIds.push(rows[0]!.id);
      console.log(`Importación ${rows[0]!.id} solicitada (${source} · provincia ${province} · ${list.length} municipios)`);
    } catch (err) {
      // P. ej. ya hay una importación igual en curso: sus tareas siguen en la cola y se procesan abajo.
      console.warn(`Provincia ${province}: ${(err as Error).message}`);
    }
  }

  const geo = await drainQueue(db, config);
  if (runIds.length > 0) {
    const run = await db.query(
      "select source_version, status, stats from public.import_runs where id = any($1::uuid[]) order by created_at",
      [runIds],
    );
    for (const r of run.rows) console.log("Resultado:", JSON.stringify(r));
  }
  console.log("Geocodificador:", JSON.stringify(geo));
} finally {
  await db.end();
}
