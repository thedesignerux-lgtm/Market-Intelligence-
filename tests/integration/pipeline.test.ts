// Pruebas de integración de la ingesta contra PostgreSQL real (base de datos de pruebas).
// Usan DATOS DE PRUEBA claramente marcados (fuente "manual", ids "TEST-..."), en una transacción
// que se deshace al final: nunca se mezclan con los datos reales.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRecord, markMissing } from "../../worker/pipeline";
import type { NormalizedRecord } from "../../src/lib/domain/records";
import { normalizeName } from "../../src/lib/domain/normalize";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

function fixture(over: Partial<NormalizedRecord> & { externalId: string; name: string }): NormalizedRecord {
  return {
    sourceId: "manual",
    payload: { test_fixture: true, ...over },
    sourceUrl: null,
    entityType: "club",
    normalizedName: normalizeName(over.name),
    categories: [{ categoryId: "club.deportivo.ciclismo", priority: 200 }],
    address: null,
    postalCode: null,
    municipalityCode: "15078",
    location: null,
    phones: [],
    websites: [],
    emails: [],
    identifiers: [],
    openingHours: null,
    ...over,
  };
}

d("ingesta (integración)", () => {
  let client: pg.PoolClient;
  let pool: pg.Pool;
  const runId = "00000000-0000-0000-0000-0000000000aa";
  const ctx = { runId, taskId: 0, sourceConfidence: 0.9 };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    client = await pool.connect();
    await client.query("begin");
    await client.query(
      "insert into public.import_runs (id, source_id, scope) values ($1, 'manual', '{\"test\": true}')",
      [runId],
    );
  });

  afterAll(async () => {
    await client?.query("rollback");
    client?.release();
    await pool?.end();
  });

  const loc = (lon: number, lat: number) => ({ lon, lat, precision: "exact" as const, sourceId: "manual", method: "found" as const, confidence: 0.9 });

  it("crea una entidad nueva y la reimportación no duplica", async () => {
    const r = fixture({ externalId: "TEST-1", name: "Club Ciclista Prueba Alfa", location: loc(-8.55, 42.88) });
    expect(await ingestRecord(client, r, ctx)).toBe("created");
    expect(await ingestRecord(client, r, ctx)).toBe("unchanged");
    const { rows } = await client.query("select count(*)::int n from public.source_records where external_id = 'TEST-1'");
    expect(rows[0].n).toBe(1);
  });

  it("actualiza cuando cambia el registro de origen y conserva la procedencia", async () => {
    const r = fixture({ externalId: "TEST-1", name: "Club Ciclista Prueba Alfa", location: loc(-8.55, 42.88), postalCode: "15701" });
    expect(await ingestRecord(client, r, ctx)).toBe("updated");
    const { rows } = await client.query(
      `select e.postal_code, fv.source_id from public.entities e join public.field_values fv on fv.entity_id = e.id and fv.field = 'postal_code'
        join public.entity_sources es on es.entity_id = e.id join public.source_records sr on sr.id = es.source_record_id
       where sr.external_id = 'TEST-1'`,
    );
    expect(rows[0]).toEqual({ postal_code: "15701", source_id: "manual" });
  });

  it("vincula automáticamente un registro de otra fuente con mismo teléfono y misma ubicación", async () => {
    const a = fixture({ externalId: "TEST-2", name: "Ciclos Beta", entityType: "comercio", categories: [{ categoryId: "comercio.deporte.ciclismo", priority: 200 }],
      location: loc(-8.5401, 42.8801), phones: [{ raw: "981000001", e164: "+34981000001", isPersonal: false }] });
    expect(await ingestRecord(client, a, ctx)).toBe("created");
    const b = { ...a, sourceId: "osm", externalId: "node/TEST-2", name: "Ciclos Beta S.L.", normalizedName: normalizeName("Ciclos Beta S.L."),
      location: loc(-8.5402, 42.8802) };
    expect(await ingestRecord(client, b, ctx)).toBe("linked");
    const { rows } = await client.query(
      `select count(distinct es.entity_id)::int n from public.entity_sources es join public.source_records sr on sr.id = es.source_record_id
        where sr.external_id in ('TEST-2', 'node/TEST-2')`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("un nombre parecido sin más señales no se fusiona: queda como posible duplicado", async () => {
    const a = fixture({ externalId: "TEST-3", name: "Club Ciclista Gamma Compostela" });
    await ingestRecord(client, a, ctx);
    const b = { ...fixture({ externalId: "osm-TEST-3", name: "Gamma Compostela" }), sourceId: "osm" };
    expect(await ingestRecord(client, b, ctx)).toBe("created_for_review");
    const { rows } = await client.query("select count(*)::int n from public.duplicate_candidates where status = 'pending'");
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("un dato manual no se sobrescribe con un dato importado", async () => {
    const { rows: [e] } = await client.query(
      "select es.entity_id id from public.entity_sources es join public.source_records sr on sr.id = es.source_record_id where sr.external_id = 'TEST-1'",
    );
    await client.query(
      `insert into public.field_values (entity_id, field, value, source_id, method, confidence) values ($1, 'name', '"Nombre corregido a mano"', 'manual', 'manual', 0.95)`,
      [e.id],
    );
    await client.query("select public.refresh_entity($1)", [e.id]);
    const r = fixture({ externalId: "TEST-1", name: "CLUB CICLISTA PRUEBA ALFA (NUEVO)", location: loc(-8.55, 42.88), postalCode: "15701" });
    await ingestRecord(client, r, ctx);
    const { rows } = await client.query("select name from public.entities where id = $1", [e.id]);
    expect(rows[0].name).toBe("Nombre corregido a mano");
  });

  it("los registros que dejan de aparecer se marcan, no se borran", async () => {
    await client.query(
      "insert into public.import_runs (id, source_id, scope) values ('00000000-0000-0000-0000-0000000000bb', 'manual', '{\"test\": 2}')",
    );
    const n = await markMissing(client, "manual", "15078", "00000000-0000-0000-0000-0000000000bb");
    expect(n).toBeGreaterThan(0);
    const { rows } = await client.query(
      `select e.status from public.entities e join public.entity_sources es on es.entity_id = e.id
        join public.source_records sr on sr.id = es.source_record_id where sr.external_id = 'TEST-3'`,
    );
    expect(rows[0].status).toBe("unverified");
  });
});
