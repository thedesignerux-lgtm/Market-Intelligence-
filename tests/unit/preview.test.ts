// Previsualización: clasifica sin escribir y con las mismas reglas que la ingesta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedRecord } from "../../src/lib/domain/records";
import type { CandidateRow } from "../../worker/pipeline";
import type { Db } from "../../worker/db";

const findCandidates = vi.fn<() => Promise<CandidateRow[]>>();

vi.mock("../../worker/pipeline", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../worker/pipeline")>();
  return { ...real, findCandidates: () => findCandidates() };
});

const { previsualizar } = await import("../../worker/preview");

const registro = (nombre: string, extra: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  sourceId: "osm",
  externalId: `node/${nombre.replace(/\W/g, "")}`,
  payload: {},
  sourceUrl: null,
  entityType: "comercio",
  name: nombre,
  normalizedName: nombre.toLowerCase(),
  categories: [{ categoryId: "comercio.deporte.ciclismo", priority: 200 }],
  address: null,
  postalCode: null,
  municipalityCode: "28079",
  location: null,
  phones: [],
  websites: [],
  emails: [],
  identifiers: [],
  openingHours: null,
  ...extra,
});

const candidato = (nombre: string, over: Partial<CandidateRow> = {}): CandidateRow => ({
  id: "ent-1",
  entity_type: "comercio",
  normalized_name: nombre,
  lon: null,
  lat: null,
  location_precision: "unknown",
  municipality_code: "28079",
  phones: [],
  domains: [],
  nifs: [],
  has_same_source: false,
  ...over,
});

/** Base de datos falsa de solo lectura. Registra todo el SQL para poder probar que no escribe. */
function fakeDb(vinculado = false) {
  const sql: string[] = [];
  const cliente = {
    query: async (text: string) => {
      sql.push(text);
      if (text.includes("entity_sources")) {
        return vinculado ? { rowCount: 1, rows: [{ entity_id: "ent-9", name: "Ya existente" }] } : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => {},
  };
  const db = { connect: async () => cliente, query: cliente.query } as unknown as Db;
  return { db, sql };
}

beforeEach(() => {
  findCandidates.mockReset();
  findCandidates.mockResolvedValue([]);
});

describe("previsualización", () => {
  it("no escribe nada en la base de datos", async () => {
    const { db, sql } = fakeDb();
    await previsualizar(db, "osm", [registro("Bicis Uno"), registro("Bicis Dos")]);
    const escrituras = sql.filter((s) => /\b(insert|update|delete|truncate|alter|drop)\b/i.test(s));
    expect(escrituras).toEqual([]);
  });

  it("clasifica como nueva lo que no se parece a nada", async () => {
    const { db } = fakeDb();
    const i = await previsualizar(db, "osm", [registro("Bicis Uno")]);
    expect(i.nuevas).toHaveLength(1);
    expect(i.existentes).toHaveLength(0);
    expect(i.duplicados).toHaveLength(0);
  });

  it("clasifica como existente lo ya importado antes desde la misma fuente", async () => {
    const { db } = fakeDb(true);
    const i = await previsualizar(db, "osm", [registro("Bicis Uno")]);
    expect(i.existentes).toHaveLength(1);
    expect(i.existentes[0]!.entidad!.id).toBe("ent-9");
    expect(i.existentes[0]!.motivo).toMatch(/actualizar/i);
  });

  it("clasifica como existente lo que empareja de verdad: mismo nombre y mismo teléfono", async () => {
    const { db } = fakeDb();
    // El emparejador exige una señal fuerte (teléfono, web o cercanía) además del nombre.
    findCandidates.mockResolvedValue([candidato("bicis uno", { phones: ["+34900000000"] })]);
    const i = await previsualizar(db, "osm", [
      registro("Bicis Uno", { phones: [{ raw: "900000000", e164: "+34900000000", isPersonal: false }] }),
    ]);
    expect(i.existentes).toHaveLength(1);
    expect(i.nuevas).toHaveLength(0);
    expect(i.existentes[0]!.motivo).toMatch(/vincular/i);
  });

  it("manda a duplicados el nombre igual sin señal fuerte, en vez de fusionarlo solo", async () => {
    const { db } = fakeDb();
    // Mismo nombre y mismo municipio, pero ni teléfono ni web ni coordenadas en común.
    findCandidates.mockResolvedValue([candidato("bicis uno")]);
    const i = await previsualizar(db, "osm", [registro("Bicis Uno")]);
    expect(i.duplicados).toHaveLength(1);
    expect(i.existentes).toHaveLength(0);
    expect(i.duplicados[0]!.motivo).toMatch(/revisión/i);
  });

  it("detecta choques dentro del propio lote", async () => {
    const { db } = fakeDb();
    const i = await previsualizar(db, "osm", [registro("Bicis Uno"), registro("Bicis Uno")]);
    expect(i.nuevas).toHaveLength(1);
    expect(i.duplicados).toHaveLength(1);
    expect(i.duplicados[0]!.motivo).toMatch(/misma importación/i);
  });

  it("nunca empareja solo dos registros de la misma fuente", async () => {
    const { db } = fakeDb();
    findCandidates.mockResolvedValue([candidato("bicis uno", { has_same_source: true })]);
    const i = await previsualizar(db, "osm", [registro("Bicis Uno")]);
    expect(i.existentes).toHaveLength(0);
    expect(i.duplicados).toHaveLength(1);
  });

  it("cuenta los contactos disponibles y arrastra los descartes al total", async () => {
    const { db } = fakeDb();
    const conTelefono = registro("Bicis Tel", { phones: [{ raw: "900", e164: "+34900000000", isPersonal: false }] });
    const conEmail = registro("Bicis Mail", { emails: [{ raw: "a@b.c", normalized: "a@b.c", isPersonal: false }] });
    const i = await previsualizar(db, "osm", [conTelefono, conEmail, registro("Bicis Mudo")], [
      { externalId: "node/1", nombre: "Decathlon", motivo: "Cadena excluida de la captación comercial" },
    ]);

    expect(i.total).toBe(4);
    expect(i.contactos.conAlgunCanal).toBe(2);
    expect(i.contactos.sinNingunCanal).toBe(1);
    expect(i.contactos.telefono).toBe(1);
    expect(i.contactos.email).toBe(1);
    expect(i.descartadas).toHaveLength(1);
  });

  it("el total cuadra siempre: nuevas + existentes + duplicados + descartados", async () => {
    const { db } = fakeDb();
    const i = await previsualizar(
      db,
      "osm",
      [registro("A"), registro("B"), registro("A")],
      [{ externalId: "x", nombre: "X", motivo: "sin nombre" }],
    );
    expect(i.nuevas.length + i.existentes.length + i.duplicados.length + i.descartadas.length).toBe(i.total);
  });
});
