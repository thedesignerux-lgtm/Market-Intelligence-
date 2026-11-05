// Previsualización de una importación de OpenStreetMap: dice qué pasaría, sin escribir nada.
//
// Uso:
//   npm run previsualizar -- osm madrid
//   npm run previsualizar -- osm barcelona madrid
//   npm run previsualizar -- osm 28079 --detalle
//
// Descarga el extracto y consulta la base de datos solo para leer. No crea importaciones,
// no inserta entidades y no modifica nada. Usa las mismas reglas de categorías, los mismos
// descartes y el mismo emparejamiento que la importación real.

import { loadConfig } from "./config";
import { createPool } from "./db";
import { construirRegistrosOsm } from "./handlers";
import { previsualizar, resumen, type Descartada, type InformePrevio } from "./preview";
import { provincesForScope } from "../src/lib/domain/territory";
import type { NormalizedRecord } from "../src/lib/domain/records";

const args = process.argv.slice(2);
const detalle = args.includes("--detalle");
const json = args.includes("--json");
const [fuente, ...ambitos] = args.filter((a) => !a.startsWith("--"));

if (fuente !== "osm" || ambitos.length === 0) {
  console.error("Uso: npm run previsualizar -- osm <municipio INE | provincia | comunidad> [...] [--detalle] [--json]");
  process.exit(2);
}

async function main() {
  const config = loadConfig();
  const db = createPool(config.DATABASE_URL);
  try {
    // Un ámbito es un municipio (5 dígitos) o algo que se resuelve a provincias.
    const municipios: string[] = [];
    for (const a of ambitos) {
      if (/^\d{5}$/.test(a)) {
        municipios.push(a);
        continue;
      }
      const provincias = provincesForScope(a);
      if (!provincias?.length) throw new Error(`Ámbito no reconocido: ${a}`);
      const { rows } = await db.query<{ code: string }>(
        `select code from public.admin_areas
          where level = 'municipio' and left(code, 2) = any($1::text[]) and geom is not null
          order by code`,
        [provincias],
      );
      if (rows.length === 0) {
        throw new Error(
          `No hay municipios cargados para «${a}». Se cargan solos en la primera importación de esa provincia.`,
        );
      }
      municipios.push(...rows.map((r) => r.code));
    }

    const registros: NormalizedRecord[] = [];
    const descartadas: Descartada[] = [];
    const stats: Record<string, number> = {};
    let hecho = 0;
    for (const muni of municipios) {
      const r = await construirRegistrosOsm(db, config, muni);
      registros.push(...r.records);
      descartadas.push(...r.descartadas);
      for (const [k, v] of Object.entries(r.stats)) stats[k] = (stats[k] ?? 0) + (v as number);
      hecho++;
      if (!json && municipios.length > 1 && hecho % 25 === 0) {
        process.stderr.write(`  ${hecho}/${municipios.length} municipios…\n`);
      }
    }

    const informe = await previsualizar(db, "osm", registros, descartadas);
    if (json) {
      console.log(JSON.stringify(informe, null, 2));
      return;
    }
    console.log(resumen(informe));
    console.log(`\n  Motivos de descarte:`);
    const porMotivo = new Map<string, number>();
    for (const d of informe.descartadas) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1);
    for (const [m, n] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}  ${m}`);
    }
    if (detalle) imprimirDetalle(informe);
  } finally {
    await db.end();
  }
}

function imprimirDetalle(i: InformePrevio) {
  const bloque = (titulo: string, filas: InformePrevio["nuevas"]) => {
    if (!filas.length) return;
    console.log(`\n  ${titulo} (${filas.length}):`);
    for (const f of filas.slice(0, 40)) {
      const ent = f.entidad ? ` → ${f.entidad.nombre} (${f.entidad.puntuacion.toFixed(2)})` : "";
      console.log(`    · ${f.nombre.slice(0, 44).padEnd(44)}${ent}`);
    }
    if (filas.length > 40) console.log(`    … y ${filas.length - 40} más`);
  };
  bloque("Nuevas", i.nuevas);
  bloque("Existentes", i.existentes);
  bloque("Duplicados a revisar", i.duplicados);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
