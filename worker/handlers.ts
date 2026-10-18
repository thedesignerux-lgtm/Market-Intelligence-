// Ejecución de tareas de importación: una tarea = una fuente × un municipio.

import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config";
import { withTx, type Db } from "./db";
import { Geocoder } from "./geocode";
import { ingestRecord, markMissing, type IngestOutcome } from "./pipeline";
import { RED_SOURCE_ID, fetchRedCsv, parseRedCsv, redRowToRecord } from "./sources/red";
import {
  OSM_SOURCE_ID,
  PROVINCE_EXTRACTS,
  ensureExtract,
  extractFeatures,
  extractMunicipalities,
  osmFeatureToRecord,
  representativePoint,
  type OsmFeature,
} from "./sources/osm";
import type { CategoryMapping } from "../src/lib/domain/categories";
import type { NormalizedRecord } from "../src/lib/domain/records";

export interface ImportTask {
  id: number;
  run_id: string;
  task_key: string;
  params: { municipality: string; categories?: string[] | null };
  attempts: number;
  max_attempts: number;
}

export type TaskStats = Record<string, number>;

/** Error que no merece reintento (datos o configuración inválidos). */
export class PermanentTaskError extends Error {}

export async function loadMappings(db: Db): Promise<CategoryMapping[]> {
  const { rows } = await db.query<{ source_id: string; match: Record<string, string>; category_id: string; entity_type: string; priority: number }>(
    "select source_id, match, category_id, entity_type::text, priority from public.category_mappings",
  );
  return rows.map((r) => ({ sourceId: r.source_id, match: r.match, categoryId: r.category_id, entityType: r.entity_type, priority: r.priority }));
}

async function sourceConfidence(db: Db, sourceId: string): Promise<number> {
  const { rows } = await db.query<{ c: string }>("select default_confidence as c from public.sources where id = $1", [sourceId]);
  return Number(rows[0]?.c ?? 0.5);
}

/** Garantiza que el municipio existe con su polígono (se carga de OSM la primera vez). */
export async function ensureMunicipality(db: Db, config: Config, code: string): Promise<{ name: string }> {
  const existing = await db.query<{ name: string }>(
    "select name from public.admin_areas where code = $1 and level = 'municipio' and geom is not null",
    [code],
  );
  if (existing.rowCount) return { name: existing.rows[0]!.name };

  await loadProvinceMunicipalities(db, config, code.slice(0, 2));
  const after = await db.query<{ name: string }>(
    "select name from public.admin_areas where code = $1 and geom is not null",
    [code],
  );
  if (!after.rowCount) throw new PermanentTaskError(`El municipio ${code} no aparece en los límites de OSM`);
  return { name: after.rows[0]!.name };
}

/** Códigos INE de todos los municipios de una provincia (carga sus límites de OSM si faltan). */
export async function provinceMunicipalityCodes(db: Db, config: Config, province: string): Promise<string[]> {
  const sql = "select code from public.admin_areas where level = 'municipio' and parent_code = $1 and geom is not null order by code";
  let { rows } = await db.query<{ code: string }>(sql, [province]);
  if (rows.length === 0) {
    await loadProvinceMunicipalities(db, config, province);
    ({ rows } = await db.query<{ code: string }>(sql, [province]));
  }
  return rows.map((r) => r.code);
}

async function loadProvinceMunicipalities(db: Db, config: Config, province: string): Promise<void> {
  if (!PROVINCE_EXTRACTS[province]) throw new PermanentTaskError(`Provincia ${province} fuera de la cobertura configurada`);
  const { file } = await ensureExtract(config, province);
  const munis = await extractMunicipalities(file, province, path.join(config.CACHE_DIR, "work", `admin-${province}`));
  if (munis.length === 0) throw new Error(`No se encontraron límites municipales en el extracto de ${province}`);
  await withTx(db, async (tx) => {
    for (const m of munis) {
      await tx.query(
        `insert into public.admin_areas (code, level, name, parent_code, geom, source_id, updated_at)
         values ($1, 'municipio', $2, $3,
                 extensions.st_multi(extensions.st_makevalid(extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326))),
                 'osm', now())
         on conflict (code) do update set name = excluded.name, geom = excluded.geom, updated_at = now()`,
        [m.code, m.name, province, JSON.stringify(m.geometry)],
      );
    }
  });
}

async function recordIssue(db: Db, task: ImportTask, severity: "info" | "warning" | "error", code: string, message: string) {
  await db.query(
    "insert into public.import_issues (run_id, task_id, severity, code, message) values ($1, $2, $3, $4, $5)",
    [task.run_id, task.id, severity, code, message.slice(0, 1000)],
  );
}

/** Ingresa registros uno a uno (cada uno en su transacción) para que un fallo no tumbe la tarea. */
async function ingestAll(db: Db, task: ImportTask, records: NormalizedRecord[], confidence: number, stats: TaskStats) {
  let failures = 0;
  for (const record of records) {
    try {
      const outcome: IngestOutcome = await withTx(db, (tx) =>
        ingestRecord(tx, record, { runId: task.run_id, taskId: task.id, sourceConfidence: confidence }),
      );
      stats[outcome] = (stats[outcome] ?? 0) + 1;
    } catch (err) {
      failures++;
      stats.failed_records = (stats.failed_records ?? 0) + 1;
      await recordIssue(db, task, "error", "ingest_failed", `${record.sourceId}:${record.externalId} · ${(err as Error).message}`);
    }
  }
  if (records.length > 0 && failures / records.length > 0.5) {
    throw new Error(`Fallaron ${failures} de ${records.length} registros`);
  }
}

/** Registra la versión de la fuente usada. Una importación de varias provincias acumula una versión por extracto. */
async function setRunVersion(db: Db, runId: string, version: string) {
  await db.query(
    `update public.import_runs
        set source_version = case when source_version is null or source_version = '' then $2
                                  else source_version || ', ' || $2 end
      where id = $1 and not ($2 = any (string_to_array(coalesce(source_version, ''), ', ')))`,
    [runId, version],
  );
}

export async function runRedTask(db: Db, config: Config, task: ImportTask, geocoder: Geocoder): Promise<TaskStats> {
  const muni = task.params.municipality;
  const { name: municipalityName } = await ensureMunicipality(db, config, muni);
  const mappings = await loadMappings(db);
  const { text, version } = await fetchRedCsv(config);
  await setRunVersion(db, task.run_id, version);
  const rows = parseRedCsv(text).filter((r) => r.concelloCodigo === muni);

  const stats: TaskStats = { source_rows: rows.length, in_scope: 0, geocoded: 0, not_geocoded: 0 };
  const records: NormalizedRecord[] = [];
  for (const row of rows) {
    const record = redRowToRecord(row, mappings, config.RED_CSV_URL);
    if (!record) continue;
    stats.in_scope!++;
    if (record.address) {
      try {
        record.location = await geocoder.geocode({
          address: record.address.text,
          postalCode: record.postalCode,
          municipalityName,
          municipalityCode: muni,
          streetOnly: record.address.isPersonal,
        });
      } catch (err) {
        await recordIssue(db, task, "warning", "geocoder_error", `${record.externalId}: ${(err as Error).message}`);
      }
    }
    if (record.location) stats.geocoded!++;
    else {
      stats.not_geocoded!++;
      await recordIssue(db, task, "info", "no_location", `${record.externalId} (${record.name}): sin coordenadas; no aparecerá en el mapa`);
    }
    records.push(record);
  }
  await ingestAll(db, task, records, await sourceConfidence(db, RED_SOURCE_ID), stats);
  stats.marked_missing = await withTx(db, (tx) => markMissing(tx, RED_SOURCE_ID, muni, task.run_id));
  return stats;
}

/** Filtra el extracto una vez por versión y reutiliza el resultado para todos los municipios. */
async function cachedProvinceFeatures(config: Config, file: string, version: string, mappings: CategoryMapping[]): Promise<OsmFeature[]> {
  const key = createHash("sha1").update(version + JSON.stringify(mappings.filter((m) => m.sourceId === OSM_SOURCE_ID))).digest("hex").slice(0, 12);
  const dir = path.join(config.CACHE_DIR, "work", `osm-${key}`);
  const cacheFile = path.join(dir, "features.json");
  try {
    await stat(cacheFile);
    return JSON.parse(await readFile(cacheFile, "utf8")) as OsmFeature[];
  } catch {
    const features = await extractFeatures(file, mappings, dir);
    await writeFile(cacheFile, JSON.stringify(features));
    return features;
  }
}

export async function runOsmTask(db: Db, config: Config, task: ImportTask): Promise<TaskStats> {
  const muni = task.params.municipality;
  await ensureMunicipality(db, config, muni);
  const mappings = await loadMappings(db);
  const { file, version } = await ensureExtract(config, muni.slice(0, 2));
  await setRunVersion(db, task.run_id, version);
  const features = await cachedProvinceFeatures(config, file, version, mappings);

  // Qué elementos caen dentro del municipio (PostGIS).
  const candidates: { feature: OsmFeature; point: [number, number] }[] = [];
  for (const feature of features) {
    const point = representativePoint(feature.geometry);
    if (point) candidates.push({ feature, point });
  }
  const inside = await db.query<{ i: number }>(
    `select (t.i - 1)::int as i
       from unnest($1::float8[], $2::float8[]) with ordinality as t(lon, lat, i)
      where extensions.st_contains((select geom from public.admin_areas where code = $3),
                                   extensions.st_setsrid(extensions.st_makepoint(t.lon, t.lat), 4326))`,
    [candidates.map((c) => c.point[0]), candidates.map((c) => c.point[1]), muni],
  );

  const stats: TaskStats = { province_features: features.length, in_municipality: inside.rowCount ?? 0, in_scope: 0 };
  const records: NormalizedRecord[] = [];
  for (const { i } of inside.rows) {
    const { record, skipReason } = osmFeatureToRecord(candidates[i]!.feature, muni, mappings);
    if (record) {
      records.push(record);
      stats.in_scope!++;
    } else if (skipReason) {
      stats[`skipped_${skipReason}`] = (stats[`skipped_${skipReason}`] ?? 0) + 1;
      if (skipReason === "missing_name") {
        await recordIssue(db, task, "info", "missing_name", `${candidates[i]!.feature.id}: elemento sin nombre en OSM, no importado`);
      }
    }
  }
  await ingestAll(db, task, records, await sourceConfidence(db, OSM_SOURCE_ID), stats);
  stats.marked_missing = await withTx(db, (tx) => markMissing(tx, OSM_SOURCE_ID, muni, task.run_id));
  return stats;
}
