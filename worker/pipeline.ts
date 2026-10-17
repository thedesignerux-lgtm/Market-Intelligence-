// Ingesta de un registro normalizado: guarda el original, lo vincula a una entidad
// (nueva o existente) y actualiza la procedencia de cada campo.

import { createHash } from "node:crypto";
import type { Tx } from "./db";
import type { NormalizedRecord } from "../src/lib/domain/records";
import { DEFAULT_MATCH_CONFIG, scoreMatch, type MatchCandidate, type MatchConfig } from "../src/lib/domain/matching";

export type IngestOutcome = "created" | "updated" | "unchanged" | "linked" | "created_for_review";

export interface IngestContext {
  runId: string;
  taskId: number;
  sourceConfidence: number;
  matchConfig?: MatchConfig;
}

/** JSON con claves ordenadas, para que el hash no dependa del orden de las propiedades. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function recordHash(record: NormalizedRecord): string {
  // Incluye la ubicación: si cambia la geocodificación, el registro se considera modificado.
  return createHash("sha256").update(stableStringify({ p: record.payload, l: record.location })).digest("hex");
}

function toCandidate(record: NormalizedRecord): MatchCandidate {
  return {
    normalizedName: record.normalizedName,
    entityType: record.entityType,
    location: record.location ? [record.location.lon, record.location.lat] : null,
    locationPrecise: record.location ? ["exact", "address"].includes(record.location.precision) : false,
    municipalityCode: record.municipalityCode,
    phones: record.phones.map((p) => p.e164),
    domains: record.websites.map((w) => w.normalized),
    nifs: record.identifiers.filter((i) => i.scheme === "nif").map((i) => i.value),
  };
}

interface CandidateRow {
  id: string;
  entity_type: string;
  normalized_name: string;
  lon: number | null;
  lat: number | null;
  location_precision: string;
  municipality_code: string | null;
  phones: string[];
  domains: string[];
  nifs: string[];
  has_same_source: boolean;
}

async function findCandidates(tx: Tx, record: NormalizedRecord): Promise<CandidateRow[]> {
  const c = toCandidate(record);
  const { rows } = await tx.query<CandidateRow>(
    `select e.id, e.entity_type::text, e.normalized_name,
            extensions.st_x(e.geom) as lon, extensions.st_y(e.geom) as lat,
            e.location_precision::text, e.municipality_code,
            coalesce(array(select cp.normalized from public.contact_points cp where cp.entity_id = e.id and cp.kind = 'phone'), '{}') as phones,
            coalesce(array(select cp.normalized from public.contact_points cp where cp.entity_id = e.id and cp.kind = 'website'), '{}') as domains,
            coalesce(array(select ei.value from public.entity_identifiers ei where ei.entity_id = e.id and ei.scheme = 'nif'), '{}') as nifs,
            exists (select 1 from public.entity_sources es join public.source_records sr on sr.id = es.source_record_id
                    where es.entity_id = e.id and sr.source_id = $1) as has_same_source
       from public.entities e
      where e.merged_into is null
        and e.entity_type = $2::public.entity_type
        and (
          ($3::float8 is not null and e.geom is not null and
            extensions.st_dwithin(e.geom::extensions.geography,
                                  extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography, 1000))
          or (e.municipality_code = $5 and extensions.similarity(e.normalized_name, $6) > 0.3)
          or e.id in (select ei.entity_id from public.entity_identifiers ei where ei.scheme = 'nif' and ei.value = any($7::text[]))
          or e.id in (select cp.entity_id from public.contact_points cp
                       where (cp.kind = 'phone' and cp.normalized = any($8::text[]))
                          or (cp.kind = 'website' and cp.normalized = any($9::text[])))
        )
      limit 50`,
    [
      record.sourceId,
      record.entityType,
      c.location?.[0] ?? null,
      c.location?.[1] ?? null,
      record.municipalityCode,
      record.normalizedName,
      c.nifs,
      c.phones,
      c.domains,
    ],
  );
  return rows;
}

async function createEntity(tx: Tx, record: NormalizedRecord): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.entities (entity_type, name, normalized_name, category_id, municipality_code, postal_code)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      record.entityType,
      record.name,
      record.normalizedName,
      record.categories[0]?.categoryId ?? null,
      record.municipalityCode,
      record.postalCode,
    ],
  );
  return rows[0]!.id;
}

async function writeFieldValues(tx: Tx, entityId: string, recordId: string, record: NormalizedRecord, confidence: number) {
  const values: { field: string; value: unknown; sourceId: string; method: string; confidence: number }[] = [];
  const own = (field: string, value: unknown) =>
    values.push({ field, value, sourceId: record.sourceId, method: "found", confidence });

  own("name", record.name);
  if (record.address) own("address", { text: record.address.text, is_personal: record.address.isPersonal });
  if (record.postalCode) own("postal_code", record.postalCode);
  if (record.municipalityCode) own("municipality_code", record.municipalityCode);
  if (record.phones.length) own("phone", record.phones.map((p) => p.e164));
  if (record.websites.length) own("website", record.websites.map((w) => w.normalized));
  if (record.emails.length) own("email", record.emails.map((e) => e.normalized));
  if (record.openingHours) own("opening_hours", record.openingHours);
  if (record.location) {
    values.push({
      field: "location",
      value: { lon: record.location.lon, lat: record.location.lat, precision: record.location.precision },
      sourceId: record.location.sourceId,
      method: record.location.method,
      confidence: record.location.confidence,
    });
  }

  for (const v of values) {
    await tx.query(
      `insert into public.field_values (entity_id, field, value, source_id, source_record_id, source_url, method, confidence, observed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (entity_id, field, source_id, source_record_id)
       do update set value = excluded.value, method = excluded.method, confidence = excluded.confidence,
                     source_url = excluded.source_url, observed_at = now()`,
      [entityId, v.field, JSON.stringify(v.value), v.sourceId, recordId, record.sourceUrl, v.method, v.confidence],
    );
  }
  // Campos que la fuente ya no publica: se retiran sus valores (el registro original queda en source_records).
  await tx.query(
    `delete from public.field_values where source_record_id = $1 and entity_id = $2
       and not (field = any($3::text[]) and source_id = any($4::text[]))`,
    [recordId, entityId, values.map((v) => v.field), [...new Set(values.map((v) => v.sourceId))]],
  );
}

async function writeContactsAndIdentifiers(tx: Tx, entityId: string, recordId: string, record: NormalizedRecord) {
  const contacts = [
    ...record.phones.map((p) => ({ kind: "phone", value: p.raw, normalized: p.e164, personal: p.isPersonal })),
    ...record.websites.map((w) => ({ kind: "website", value: w.raw, normalized: w.normalized, personal: false })),
    ...record.emails.map((e) => ({ kind: "email", value: e.raw, normalized: e.normalized, personal: e.isPersonal })),
  ];
  await tx.query(
    `delete from public.contact_points where source_record_id = $1
       and not ((kind || ':' || normalized) = any($2::text[]))`,
    [recordId, contacts.map((c) => `${c.kind}:${c.normalized}`)],
  );
  for (const c of contacts) {
    await tx.query(
      `insert into public.contact_points (entity_id, kind, value, normalized, is_personal_data, source_id, source_record_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (entity_id, kind, normalized) do update
         set is_personal_data = public.contact_points.is_personal_data or excluded.is_personal_data`,
      [entityId, c.kind, c.value, c.normalized, c.personal, record.sourceId, recordId],
    );
  }
  for (const id of record.identifiers) {
    await tx.query(
      `insert into public.entity_identifiers (entity_id, scheme, value, source_record_id)
       values ($1, $2, $3, $4) on conflict do nothing`,
      [entityId, id.scheme, id.value, recordId],
    );
  }
  for (const cat of record.categories) {
    await tx.query(
      `insert into public.entity_categories (entity_id, category_id, source_id) values ($1, $2, $3) on conflict do nothing`,
      [entityId, cat.categoryId, record.sourceId],
    );
  }
}

/** Ingresa un registro. Debe llamarse dentro de una transacción. */
export async function ingestRecord(tx: Tx, record: NormalizedRecord, ctx: IngestContext): Promise<IngestOutcome> {
  const hash = recordHash(record);
  // Serializa la ingesta por municipio: evita que dos tareas creen a la vez la misma entidad.
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`ingest:${record.municipalityCode ?? "none"}`]);

  const previous = await tx.query<{ payload_hash: string }>(
    "select payload_hash from public.source_records where source_id = $1 and external_id = $2 for update",
    [record.sourceId, record.externalId],
  );
  const contentUnchanged = previous.rows[0]?.payload_hash === hash;

  const up = await tx.query<{ id: string; inserted: boolean }>(
    `insert into public.source_records (source_id, external_id, payload, payload_hash, last_import_run)
     values ($1, $2, $3, $4, $5)
     on conflict (source_id, external_id) do update set
       payload = excluded.payload,
       last_seen_at = now(),
       last_changed_at = case when public.source_records.payload_hash <> excluded.payload_hash then now()
                              else public.source_records.last_changed_at end,
       payload_hash = excluded.payload_hash,
       missing_since = null,
       last_import_run = excluded.last_import_run
     returning id, (xmax = 0) as inserted`,
    [record.sourceId, record.externalId, JSON.stringify(record.payload), hash, ctx.runId],
  );
  const recordId = up.rows[0]!.id;

  // Ya vinculado: actualizar solo si el contenido cambió.
  const linked = await tx.query<{ entity_id: string }>(
    `select es.entity_id from public.entity_sources es where es.source_record_id = $1`,
    [recordId],
  );
  if (linked.rowCount) {
    const entityId = linked.rows[0]!.entity_id;
    const { rows } = await tx.query<{ n: number }>(
      `select count(*)::int as n from public.field_values where source_record_id = $1`,
      [recordId],
    );
    const unchanged = contentUnchanged && rows[0]!.n > 0;
    if (unchanged) {
      await tx.query("select public.refresh_entity($1)", [entityId]);
      return "unchanged";
    }
    await writeFieldValues(tx, entityId, recordId, record, ctx.sourceConfidence);
    await writeContactsAndIdentifiers(tx, entityId, recordId, record);
    await tx.query("select public.refresh_entity($1)", [entityId]);
    return "updated";
  }

  // Registro nuevo: buscar si ya existe la entidad (por otra fuente).
  const config = ctx.matchConfig ?? DEFAULT_MATCH_CONFIG;
  const me = toCandidate(record);
  const scored = (await findCandidates(tx, record))
    .map((row) => {
      const result = scoreMatch(
        me,
        {
          normalizedName: row.normalized_name,
          entityType: row.entity_type,
          location: row.lon != null && row.lat != null ? [row.lon, row.lat] : null,
          locationPrecise: ["exact", "address"].includes(row.location_precision),
          municipalityCode: row.municipality_code,
          phones: row.phones,
          domains: row.domains,
          nifs: row.nifs,
        },
        config,
      );
      // Dos registros distintos de la misma fuente nunca se unen solos: van a revisión.
      if (result.decision === "same" && row.has_same_source) {
        return { row, result: { ...result, decision: "review" as const, signals: { ...result.signals, same_source: true } } };
      }
      return { row, result };
    })
    .filter((x) => x.result.decision !== "different")
    .sort((a, b) => b.result.score - a.result.score);

  const best = scored[0];
  let entityId: string;
  let outcome: IngestOutcome;
  if (best && best.result.decision === "same") {
    entityId = best.row.id;
    await tx.query(
      `insert into public.entity_sources (source_record_id, entity_id, link_method, confidence) values ($1, $2, 'auto_match', $3)`,
      [recordId, entityId, best.result.score],
    );
    outcome = "linked";
  } else {
    entityId = await createEntity(tx, record);
    await tx.query(
      `insert into public.entity_sources (source_record_id, entity_id, link_method, confidence) values ($1, $2, 'created', 1)`,
      [recordId, entityId],
    );
    outcome = scored.length ? "created_for_review" : "created";
    for (const s of scored.slice(0, 5)) {
      const [a, b] = [entityId, s.row.id].sort();
      await tx.query(
        `insert into public.duplicate_candidates (entity_a, entity_b, score, signals)
         values ($1, $2, $3, $4)
         on conflict (entity_a, entity_b) do update set score = excluded.score, signals = excluded.signals
           where public.duplicate_candidates.status = 'pending'`,
        [a, b, s.result.score, JSON.stringify(s.result.signals)],
      );
    }
  }

  await writeFieldValues(tx, entityId, recordId, record, ctx.sourceConfidence);
  await writeContactsAndIdentifiers(tx, entityId, recordId, record);
  await tx.query("select public.refresh_entity($1)", [entityId]);
  return outcome;
}

/**
 * Tras importar un municipio completo: los registros de esa fuente que no aparecieron en esta
 * importación se marcan como "no vistos" (nunca se borran) y sus entidades se recalculan.
 */
export async function markMissing(tx: Tx, sourceId: string, municipalityCode: string, runId: string): Promise<number> {
  const { rows } = await tx.query<{ entity_id: string }>(
    `update public.source_records sr set missing_since = now()
       from public.entity_sources es join public.entities e on e.id = es.entity_id
      where es.source_record_id = sr.id and sr.source_id = $1 and e.municipality_code = $2
        and sr.last_import_run is distinct from $3 and sr.missing_since is null
      returning es.entity_id`,
    [sourceId, municipalityCode, runId],
  );
  for (const r of rows) await tx.query("select public.refresh_entity($1)", [r.entity_id]);
  return rows.length;
}
