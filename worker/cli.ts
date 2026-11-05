// Uso: npm run import -- <fuente> <ámbito> [ámbito...]
// Ámbito: código INE de municipio (15078), código de provincia (15), una comunidad
// (galicia, andalucia, madrid… ver src/lib/domain/territory.ts) o «espana» (las 52 provincias).
// Ejemplos:
//   npm run import -- red_galicia 15078
//   npm run import -- osm galicia
//   npm run import -- osm espana
//   npm run import -- registro_cataluna cataluna
//   npm run import -- clubes espana      (todos los registros autonómicos, cada uno en su territorio)
// Solicita una importación por provincia (como la aplicación) y procesa la cola en este proceso.
// Si el proceso se corta, las tareas pendientes se retoman en la siguiente ejecución del worker.
import { loadConfig } from "./config";
import { createPool, type Db } from "./db";
import { provinceMunicipalityCodes } from "./handlers";
import { drainQueue } from "./runner";
import { REGISTRIES } from "./sources/registries";
import { provincesForScope } from "../src/lib/domain/territory";
import type { Config } from "./config";

const [sourceArg, ...scopes] = process.argv.slice(2);
if (!sourceArg || scopes.length === 0) {
  const all = ["osm", "red_galicia", ...Object.keys(REGISTRIES), "clubes"].join("|");
  console.error(`Uso: npm run import -- <${all}> <municipio INE | provincia | comunidad | espana> [...]`);
  process.exit(2);
}
// «clubes» = todos los registros autonómicos de entidades deportivas.
const sources = sourceArg === "clubes" ? Object.keys(REGISTRIES) : [sourceArg];

/** Provincias que cubre una fuente (null = sin límite, como OSM). */
function coverage(source: string): string[] | null {
  return REGISTRIES[source]?.provinces ?? (source === "red_galicia" ? ["15", "27", "32", "36"] : null);
}

/** Municipios del ámbito pedido, agrupados por provincia y limitados a la cobertura de la fuente. */
async function municipalitiesByProvince(db: Db, config: Config, source: string): Promise<Map<string, string[]>> {
  const covered = coverage(source);
  const inCoverage = (province: string) => !covered || covered.includes(province);
  const byProvince = new Map<string, Set<string>>();
  const add = (code: string) => {
    const p = code.slice(0, 2);
    if (!byProvince.has(p)) byProvince.set(p, new Set());
    byProvince.get(p)!.add(code);
  };
  for (const scope of scopes) {
    const provinces = provincesForScope(scope);
    if (provinces) {
      for (const p of provinces.filter(inCoverage)) {
        try {
          for (const code of await provinceMunicipalityCodes(db, config, p)) add(code);
        } catch (err) {
          console.error(`Provincia ${p}: no se pudieron cargar sus municipios (${(err as Error).message}). Se omite.`);
        }
      }
    } else if (/^\d{5}$/.test(scope)) {
      if (inCoverage(scope.slice(0, 2))) add(scope);
    } else {
      throw new Error(`Ámbito no válido: ${scope}`);
    }
  }
  return new Map([...byProvince.entries()].sort().map(([p, set]) => [p, [...set].sort()]));
}

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
try {
  // Una importación por fuente y provincia (máximo 400 municipios cada una).
  const runIds: string[] = [];
  for (const source of sources) {
    const groups = await municipalitiesByProvince(db, config, source);
    if (groups.size === 0) console.warn(`${source}: ningún municipio del ámbito pedido está en su cobertura.`);
    for (const [province, list] of groups) {
      try {
        const { rows } = await db.query<{ id: string }>("select public.request_import($1, $2) as id", [source, list]);
        runIds.push(rows[0]!.id);
        console.log(`Importación ${rows[0]!.id} solicitada (${source} · provincia ${province} · ${list.length} municipios)`);
      } catch (err) {
        // P. ej. ya hay una importación igual en curso: sus tareas siguen en la cola y se procesan abajo.
        console.warn(`${source} · provincia ${province}: ${(err as Error).message}`);
      }
    }
  }

  const geo = await drainQueue(db, config);
  if (runIds.length > 0) {
    const run = await db.query(
      "select source_id, source_version, status, stats from public.import_runs where id = any($1::uuid[]) order by created_at",
      [runIds],
    );
    for (const r of run.rows) console.log("Resultado:", JSON.stringify(r));
  }
  console.log("Geocodificador:", JSON.stringify(geo));
} finally {
  await db.end();
}
