// La previsualización no debe escribir NADA, ni siquiera de forma indirecta.
//
// La prueba envuelve el camino completo —construirRegistrosOsm + previsualizar— en una base
// de datos centinela que lanza excepción ante cualquier sentencia de escritura. Si alguien
// vuelve a meter un insert en esa ruta (por ejemplo cargando límites municipales), esto falla.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "../../worker/config";
import type { Db } from "../../worker/db";
import type { OsmFeature } from "../../worker/sources/osm";

const ensureExtract = vi.fn(async () => ({ file: "/tmp/falso.osm.pbf", version: "v-test" }));
const extractFeatures = vi.fn<(pbf: string, m: unknown, workDir: string) => Promise<OsmFeature[]>>();
const extractMunicipalities = vi.fn<() => Promise<{ code: string; name: string; geometry: unknown }[]>>();

vi.mock("../../worker/sources/osm", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../worker/sources/osm")>();
  return {
    ...real,
    PROVINCE_EXTRACTS: { "28": "europe/spain/comunidad_de_madrid" },
    ensureExtract: () => ensureExtract(),
    extractFeatures: (pbf: string, m: unknown, workDir: string) => extractFeatures(pbf, m, workDir),
    extractMunicipalities: () => extractMunicipalities(),
  };
});

const { construirRegistrosOsm } = await import("../../worker/handlers");
const { limitesDelExtracto, limitesDeBaseDeDatos } = await import("../../worker/limites");
const { previsualizar } = await import("../../worker/preview");

const ESCRITURA = /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|merge|copy)\b/i;

/** Base de datos que solo tolera lecturas. Cualquier escritura revienta la prueba. */
function dbCentinela() {
  const sql: string[] = [];
  const responder = async (text: string) => {
    sql.push(text);
    if (ESCRITURA.test(text)) {
      throw new Error(`La previsualización intentó ESCRIBIR: ${text.trim().slice(0, 120)}`);
    }
    if (text.includes("category_mappings")) {
      return {
        rowCount: 1,
        rows: [{ source_id: "osm", match: { shop: "bicycle" }, category_id: "comercio.deporte.ciclismo", entity_type: "comercio", priority: 200 }],
      };
    }
    // La contención devuelve el índice del único punto de la prueba.
    if (text.includes("st_contains")) return { rowCount: 1, rows: [{ i: 0 }] };
    return { rowCount: 0, rows: [] };
  };
  const cliente = { query: responder, release: () => {} };
  const db = { query: responder, connect: async () => cliente } as unknown as Db;
  return { db, sql };
}

const tienda = (id: string, nombre: string, lon: number, lat: number): OsmFeature => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { name: nombre, shop: "bicycle" },
});

let config: Config;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prev-"));
  config = { CACHE_DIR: dir, WORKER_ID: "test" } as Config;
  ensureExtract.mockClear();
  // El extractor real crea su directorio de trabajo; el simulado también debe hacerlo,
  // porque cachedProvinceFeatures escribe ahí su caché (en disco local, no en la base).
  extractFeatures.mockImplementation(async (_pbf, _m, workDir) => {
    await mkdir(workDir, { recursive: true });
    return [tienda("n1", "Bicis Centinela", -3.7, 40.4)];
  });
  extractMunicipalities.mockResolvedValue([
    { code: "28079", name: "Madrid", geometry: { type: "Polygon", coordinates: [[[-3.9, 40.3], [-3.5, 40.3], [-3.5, 40.5], [-3.9, 40.5], [-3.9, 40.3]]] } },
  ]);
});

describe("la previsualización es de solo lectura", () => {
  it("no ejecuta ninguna escritura en el camino completo", async () => {
    const { db, sql } = dbCentinela();
    const limites = limitesDelExtracto(db, config);

    // Camino completo: construir registros + clasificarlos.
    const { records } = await construirRegistrosOsm(db, config, "28079", limites);
    const informe = await previsualizar(db, "osm", records);

    expect(records).toHaveLength(1);
    expect(informe.nuevas).toHaveLength(1);
    // Comprobación explícita además de la excepción del centinela.
    expect(sql.filter((s) => ESCRITURA.test(s))).toEqual([]);
    expect(sql.length).toBeGreaterThan(0);
  });

  it("no consulta admin_areas en ningún momento", async () => {
    const { db, sql } = dbCentinela();
    const limites = limitesDelExtracto(db, config);
    await construirRegistrosOsm(db, config, "28079", limites);
    expect(sql.some((s) => s.includes("admin_areas"))).toBe(false);
  });

  it("resuelve la contención en PostGIS con el polígono como parámetro", async () => {
    const { db, sql } = dbCentinela();
    await construirRegistrosOsm(db, config, "28079", limitesDelExtracto(db, config));
    const contencion = sql.find((s) => s.includes("st_contains"))!;
    expect(contencion).toContain("st_geomfromgeojson");
    expect(contencion).toContain("st_makevalid");
    // La misma función que usa la importación real, no una geometría propia.
    expect(contencion).toContain("st_contains");
  });

  it("lee los límites del extracto una sola vez por provincia", async () => {
    const { db } = dbCentinela();
    const limites = limitesDelExtracto(db, config);
    await construirRegistrosOsm(db, config, "28079", limites);
    await construirRegistrosOsm(db, config, "28079", limites);
    expect(extractMunicipalities).toHaveBeenCalledTimes(1);
  });

  it("avisa si el municipio no aparece en los límites del extracto, en vez de callar", async () => {
    const { db } = dbCentinela();
    const limites = limitesDelExtracto(db, config);
    await expect(limites.contiene("28001", [[-3.7, 40.4]])).rejects.toThrow(/no aparece en los límites/i);
  });
});

describe("la importación real no cambia", () => {
  it("sin proveedor explícito, los límites salen de admin_areas", async () => {
    const { db, sql } = dbCentinela();
    // Se usa el proveedor de base de datos directamente: es el que aplica por defecto.
    await limitesDeBaseDeDatos(db).contiene("28079", [[-3.7, 40.4]]);
    const contencion = sql.find((s) => s.includes("st_contains"))!;
    expect(contencion).toContain("public.admin_areas");
    expect(contencion).not.toContain("st_geomfromgeojson");
  });

  it("los dos proveedores devuelven los mismos índices para los mismos puntos", async () => {
    const { db } = dbCentinela();
    const puntos: [number, number][] = [[-3.7, 40.4]];
    const a = await limitesDelExtracto(db, config).contiene("28079", puntos);
    const b = await limitesDeBaseDeDatos(db).contiene("28079", puntos);
    expect(a).toEqual(b);
  });
});
