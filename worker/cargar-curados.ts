// Cargador de datos comerciales curados (distribuidores, mayoristas, fabricantes, marcas).
//
// Uso:
//   npm run cargar -- data/distribuidores/investigacion-2026-11.json           (en seco)
//   npm run cargar -- data/distribuidores/investigacion-2026-11.json --escribir
//
// En seco por defecto: sin `--escribir` no toca la base de datos, solo dice qué pasaría.
// Con `--escribir`, ingresa por `ingestRecord`, la misma función que usa el worker, así que
// la deduplicación, la vinculación a entidades existentes y la procedencia son idénticas.

import path from "node:path";
import { loadConfig } from "./config";
import { createPool, withTx, type Db } from "./db";
import { ingestRecord, type IngestOutcome } from "./pipeline";
import { previsualizar, resumen } from "./preview";
import { leerFicheroCurado } from "./sources/curados";

const args = process.argv.slice(2);
const escribir = args.includes("--escribir");
const ruta = args.find((a) => !a.startsWith("--"));

if (!ruta) {
  console.error("Uso: npm run cargar -- <fichero.json> [--escribir]");
  process.exit(2);
}

/** Un run de importación para que los registros queden trazados como cualquier otro. */
async function abrirRun(db: Db, fuente: string, fichero: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.import_runs (source_id, scope, status, started_at, source_version)
     values ($1, $2, 'running', now(), $3) returning id`,
    [fuente, JSON.stringify({ fichero: path.basename(fichero), curado: true }), path.basename(fichero)],
  );
  return rows[0]!.id;
}

async function cerrarRun(db: Db, runId: string, stats: Record<string, number>) {
  await db.query(
    `update public.import_runs set status = 'succeeded', finished_at = now(), stats = $2 where id = $1`,
    [runId, JSON.stringify(stats)],
  );
}

async function main() {
  const config = loadConfig();
  const db = createPool(config.DATABASE_URL);
  try {
    const { registros, descartadas } = await leerFicheroCurado(ruta!);
    const fuente = registros[0]?.sourceId ?? "investigacion_distribuidores";

    // La previsualización siempre se ejecuta, también antes de escribir.
    const informe = await previsualizar(db, fuente, registros, descartadas);
    console.log(resumen(informe));

    if (!escribir) {
      console.log("\nEn seco: no se ha escrito nada. Añade --escribir para cargar.");
      console.log(JSON.stringify({ nuevas: informe.nuevas.length, existentes: informe.existentes.length,
                                   duplicados: informe.duplicados.length, descartadas: informe.descartadas.length }));
      return;
    }

    const fuenteExiste = await db.query("select 1 from public.sources where id = $1", [fuente]);
    if (!fuenteExiste.rowCount) {
      throw new Error(`La fuente «${fuente}» no existe. Aplica antes la migración que la da de alta.`);
    }
    const { rows: conf } = await db.query<{ c: number }>(
      "select default_confidence::float8 as c from public.sources where id = $1",
      [fuente],
    );

    const runId = await abrirRun(db, fuente, ruta!);
    const stats: Record<string, number> = { registros: registros.length, descartadas: descartadas.length };
    let fallos = 0;
    for (const r of registros) {
      try {
        const outcome: IngestOutcome = await withTx(db, (tx) =>
          ingestRecord(tx, r, { runId, taskId: 0, sourceConfidence: conf[0]!.c }),
        );
        stats[outcome] = (stats[outcome] ?? 0) + 1;
      } catch (err) {
        fallos++;
        stats.failed_records = (stats.failed_records ?? 0) + 1;
        await db.query(
          `insert into public.import_issues (run_id, severity, code, message) values ($1, 'error', 'ingest_failed', $2)`,
          [runId, `${r.sourceId}:${r.externalId} · ${(err as Error).message}`.slice(0, 1000)],
        );
        console.error(`  ✖ ${r.name}: ${(err as Error).message}`);
      }
    }
    await cerrarRun(db, runId, stats);
    console.log(`\nCargado. ${JSON.stringify(stats)}`);
    if (fallos) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
