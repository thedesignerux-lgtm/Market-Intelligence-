// OpenStreetMap: extractos provinciales (OSM France / Geofabrik) procesados con osmium.
// No se consulta Overpass para cargas masivas (ADR-0002). Licencia ODbL: atribución obligatoria.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { Config } from "../config";
import { userAgent } from "../config";
import { fetchWithRetry } from "../http";
import { matchCategories, requiredOsmFilters, type CategoryMapping } from "../../src/lib/domain/categories";
import {
  cleanAddress,
  displayName,
  normalizeName,
  normalizePhone,
  normalizePostalCode,
  normalizeWebsite,
} from "../../src/lib/domain/normalize";
import type { EntityType, NormalizedRecord } from "../../src/lib/domain/records";

const exec = promisify(execFile);
export const OSM_SOURCE_ID = "osm";

// Nombre del extracto por provincia (códigos INE).
export const PROVINCE_EXTRACTS: Record<string, string> = {
  "15": "la_coruna",
  "27": "lugo",
  "32": "ourense",
  "36": "pontevedra",
};

export interface OsmFeature {
  type: "Feature";
  id: string; // "n123", "w456", "r789"
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string>;
}

const OSM_TYPES: Record<string, string> = { n: "node", w: "way", r: "relation" };

/** Punto representativo: el propio punto o el centro de los vértices del anillo exterior. */
export function representativePoint(geometry: OsmFeature["geometry"]): [number, number] | null {
  const pts: [number, number][] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") pts.push([c[0], c[1]]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  if (geometry.type === "Point") walk(geometry.coordinates);
  else if (geometry.type === "Polygon") walk((geometry.coordinates as unknown[])[0]);
  else if (geometry.type === "MultiPolygon") walk(((geometry.coordinates as unknown[])[0] as unknown[])?.[0]);
  else walk(geometry.coordinates);
  if (pts.length === 0) return null;
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
}

const first = (...vals: (string | undefined)[]) => vals.find((v) => v && v.trim())?.trim();
const splitMulti = (v: string | undefined) => (v ? v.split(";").map((s) => s.trim()).filter(Boolean) : []);

/** Convierte un elemento de OSM al formato común. Devuelve null y un motivo si se descarta. */
export function osmFeatureToRecord(
  feature: OsmFeature,
  municipalityCode: string | null,
  mappings: CategoryMapping[],
): { record: NormalizedRecord | null; skipReason?: string } {
  const tags = feature.properties;
  const categories = matchCategories(OSM_SOURCE_ID, tags, mappings);
  if (categories.length === 0) return { record: null, skipReason: "no_category" };
  const rawName = first(tags.name, tags["name:gl"], tags["name:es"], tags.brand);
  if (!rawName) return { record: null, skipReason: "missing_name" };
  // Establecimientos cerrados o en desuso según OSM.
  if (tags["disused:shop"] || tags["was:shop"] || tags.shop === "vacant") return { record: null, skipReason: "disused" };
  const point = representativePoint(feature.geometry);
  if (!point) return { record: null, skipReason: "no_geometry" };

  const typeLetter = feature.id[0] ?? "n";
  const externalId = `${OSM_TYPES[typeLetter] ?? "node"}/${feature.id.slice(1)}`;
  const street = first(tags["addr:street"], tags["addr:place"]);
  const address = cleanAddress(street ? [street, tags["addr:housenumber"]].filter(Boolean).join(" ") : tags["addr:full"]);
  const phones = [...splitMulti(tags.phone), ...splitMulti(tags["contact:phone"]), ...splitMulti(tags.mobile)]
    .map((raw) => ({ raw, n: normalizePhone(raw) }))
    .filter((p) => p.n)
    .map((p) => ({ raw: p.raw, e164: p.n!.e164, isPersonal: false }))
    .filter((p, i, arr) => arr.findIndex((x) => x.e164 === p.e164) === i);
  const websites = [tags.website, tags["contact:website"], tags.url]
    .filter((w): w is string => Boolean(w))
    .map((raw) => ({ raw, normalized: normalizeWebsite(raw) }))
    .filter((w): w is { raw: string; normalized: string } => w.normalized !== null)
    .filter((w, i, arr) => arr.findIndex((x) => x.normalized === w.normalized) === i);
  const emails = [tags.email, tags["contact:email"]]
    .filter((e): e is string => Boolean(e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())))
    .map((raw) => ({ raw: raw.trim(), normalized: raw.trim().toLowerCase(), isPersonal: false }));
  const entityType = (categories[0]!.entityType as EntityType) ?? "comercio";
  const name = displayName(rawName);

  return {
    record: {
      sourceId: OSM_SOURCE_ID,
      externalId,
      payload: { osm_type: OSM_TYPES[typeLetter], osm_id: feature.id.slice(1), tags, point },
      sourceUrl: `https://www.openstreetmap.org/${externalId}`,
      entityType,
      name,
      normalizedName: normalizeName(name),
      categories: categories.map((c) => ({ categoryId: c.categoryId, priority: c.priority })),
      address: address ? { text: address, isPersonal: false } : null,
      postalCode: normalizePostalCode(tags["addr:postcode"]),
      municipalityCode,
      location: { lon: point[0], lat: point[1], precision: "exact", sourceId: OSM_SOURCE_ID, method: "found", confidence: 0.8 },
      phones,
      websites,
      emails,
      identifiers: [
        { scheme: "osm", value: externalId },
        ...(tags.wikidata && /^Q\d+$/.test(tags.wikidata) ? [{ scheme: "wikidata" as const, value: tags.wikidata }] : []),
      ],
      openingHours: tags.opening_hours?.slice(0, 255) ?? null,
    },
  };
}

async function fileAgeHours(file: string): Promise<number | null> {
  try {
    const s = await stat(file);
    return (Date.now() - s.mtimeMs) / 3_600_000;
  } catch {
    return null;
  }
}

/** Descarga (o reutiliza) el extracto de una provincia, verificando su MD5. */
export async function ensureExtract(config: Config, provinceCode: string): Promise<{ file: string; version: string }> {
  const name = PROVINCE_EXTRACTS[provinceCode];
  if (!name) throw new Error(`No hay extracto OSM configurado para la provincia ${provinceCode}`);
  const dir = path.join(config.CACHE_DIR, "osm");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.osm.pbf`);
  const stateFile = path.join(dir, `${name}.state.txt`);
  const age = await fileAgeHours(file);
  const base = config.OSM_EXTRACT_BASE_URL.replace(/\/$/, "");

  if (age === null || age > config.OSM_EXTRACT_MAX_AGE_HOURS) {
    const ua = userAgent(config);
    const md5Text = await (await fetchWithRetry(`${base}/${name}.osm.pbf.md5`, { userAgent: ua })).text();
    const expected = md5Text.trim().split(/\s+/)[0];
    const res = await fetchWithRetry(`${base}/${name}-latest.osm.pbf`, { userAgent: ua, timeoutMs: 15 * 60_000, retries: 2 });
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = createHash("md5").update(buf).digest("hex");
    if (expected && actual !== expected) {
      throw new Error(`El extracto ${name} no supera la verificación MD5 (esperado ${expected}, obtenido ${actual})`);
    }
    const tmp = `${file}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, file);
    const state = await (await fetchWithRetry(`${base}/${name}.state.txt`, { userAgent: ua })).text().catch(() => "");
    await writeFile(stateFile, state);
  }
  const state = await readFile(stateFile, "utf8").catch(() => "");
  const ts = state.match(/timestamp=(\S+)/)?.[1]?.replace(/\\:/g, ":") ?? "desconocida";
  return { file, version: `${name}@${ts}` };
}

async function* readGeoJsonSeq(file: string): AsyncGenerator<OsmFeature> {
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const l = line.replace(/^\x1e/, "").trim();
    if (l) yield JSON.parse(l) as OsmFeature;
  }
}

/** Filtra el extracto con osmium y devuelve los elementos candidatos. */
export async function extractFeatures(pbf: string, mappings: CategoryMapping[], workDir: string): Promise<OsmFeature[]> {
  await mkdir(workDir, { recursive: true });
  const filtered = path.join(workDir, "filtered.osm.pbf");
  const out = path.join(workDir, "features.geojsonseq");
  const filters = requiredOsmFilters(mappings);
  if (filters.length === 0) return [];
  await exec("osmium", ["tags-filter", "--overwrite", "-o", filtered, pbf, ...filters], { maxBuffer: 16 * 1024 * 1024 });
  await exec("osmium", ["export", "--overwrite", "-f", "geojsonseq", "--add-unique-id=type_id", "-o", out, filtered], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const features: OsmFeature[] = [];
  for await (const f of readGeoJsonSeq(out)) features.push(f);
  await rm(filtered, { force: true });
  return features;
}

/** Límites municipales (admin_level=8 con código INE) de una provincia, desde su extracto. */
export async function extractMunicipalities(
  pbf: string,
  provinceCode: string,
  workDir: string,
): Promise<{ code: string; name: string; geometry: unknown }[]> {
  await mkdir(workDir, { recursive: true });
  const filtered = path.join(workDir, "admin8.osm.pbf");
  const out = path.join(workDir, "admin8.geojsonseq");
  await exec("osmium", ["tags-filter", "--overwrite", "-o", filtered, pbf, "r/admin_level=8"], { maxBuffer: 16 * 1024 * 1024 });
  await exec("osmium", ["export", "--overwrite", "-f", "geojsonseq", "--geometry-types=polygon", "-o", out, filtered], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const result: { code: string; name: string; geometry: unknown }[] = [];
  for await (const f of readGeoJsonSeq(out)) {
    const code = f.properties["ine:municipio"];
    if (f.properties.boundary !== "administrative" || !code || !/^\d{5}$/.test(code) || !code.startsWith(provinceCode)) continue;
    result.push({ code, name: f.properties.name ?? code, geometry: f.geometry });
  }
  await rm(filtered, { force: true });
  return result;
}
