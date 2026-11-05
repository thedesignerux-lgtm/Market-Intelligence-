// Registros autonómicos de entidades deportivas: piezas comunes.
// Cada adaptador (cataluna.ts, euskadi.ts…) descarga su fichero y lo traduce a RegistryRow;
// a partir de ahí el tratamiento es el mismo para todas las comunidades.

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../../config";
import { userAgent } from "../../config";
import { fetchWithRetry } from "../../http";
import { matchCategories, type CategoryMapping } from "../../../src/lib/domain/categories";
import {
  addressLooksPersonal,
  cleanAddress,
  displayName,
  fold,
  normalizeName,
  normalizeNif,
  normalizePhone,
  normalizePostalCode,
  normalizeWebsite,
} from "../../../src/lib/domain/normalize";
import type { EntityType, NormalizedRecord } from "../../../src/lib/domain/records";

/** Valor canónico de modalidad que emiten todos los adaptadores para un club de ciclismo. */
export const CYCLING = "CICLISMO";

/** ¿Es una modalidad de ciclismo? (excluye motociclismo y el trial de moto). */
export function isCyclingModality(raw: string): boolean {
  const m = fold(raw);
  if (/moto/.test(m)) return false;
  return /cicl|btt|bmx|bici|bike|cicloturis|ciclocros/.test(m);
}

export interface RegistryRow {
  /** Número de inscripción en el registro (identificador estable). */
  externalId: string;
  name: string;
  /** Tipo de entidad tal como lo publica el registro. */
  kind: string;
  nif: string | null;
  /** Modalidades normalizadas; las de ciclismo llegan como CYCLING. */
  modalities: string[];
  address: string | null;
  postalCode: string | null;
  provinceCode: string | null;
  /** Código INE si la fuente lo publica; si no, se resuelve por nombre. */
  municipalityCode: string | null;
  municipalityName: string | null;
  phones: string[];
  emails: string[];
  web: string | null;
  /** Coordenadas publicadas por el propio registro (si las tiene). */
  location: { lon: number; lat: number } | null;
  /** Fila original completa. */
  raw: Record<string, unknown>;
}

export interface RegistrySource {
  id: string;
  /** Provincias (códigos INE) que cubre el registro. */
  provinces: string[];
  /** URL pública del conjunto de datos (procedencia). */
  datasetUrl: string;
  /** Descarga y traduce el registro completo. */
  load(config: Config): Promise<{ rows: RegistryRow[]; version: string }>;
}

/** Descarga un fichero una vez al día como máximo (caché en disco) y devuelve sus bytes y huella. */
export async function fetchDaily(
  config: Config,
  sourceId: string,
  name: string,
  url: string,
  maxBytes = 60 * 1024 * 1024,
): Promise<{ buf: Buffer; version: string }> {
  const dir = path.join(config.CACHE_DIR, "registros", sourceId);
  await mkdir(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${day}-${name}`);
  let buf: Buffer;
  try {
    await stat(file);
    buf = await readFile(file);
  } catch {
    const res = await fetchWithRetry(url, { userAgent: userAgent(config), timeoutMs: 180_000 });
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`${sourceId}: fichero demasiado grande (${buf.length} bytes)`);
    if (buf.length === 0) throw new Error(`${sourceId}: fichero vacío`);
    await writeFile(file, buf);
  }
  const sha = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  return { buf, version: `${day}#${sha}` };
}

/** Comprueba que el fichero trae las columnas esperadas; si la fuente cambia de formato, falla de forma explícita. */
export function requireColumns(sourceId: string, row: Record<string, unknown> | undefined, columns: string[]) {
  if (!row) throw new Error(`${sourceId}: el fichero no tiene filas`);
  const missing = columns.filter((c) => !(c in row));
  if (missing.length) throw new Error(`${sourceId}: la fuente ha cambiado de formato; faltan columnas: ${missing.join(", ")}`);
}

const FREE_MAIL = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|telefonica|movistar|terra|orange|vodafone|ono|protonmail|gmx)\./i;

function entityTypeFor(kind: string, name: string): EntityType {
  const k = fold(`${kind} ${name}`);
  return /federac/.test(k) ? "asociacion" : "club";
}

/** Convierte una fila del registro al formato común. Null si no entra en ninguna categoría configurada. */
export function registryRowToRecord(
  source: RegistrySource,
  row: RegistryRow,
  municipalityCode: string,
  mappings: CategoryMapping[],
): NormalizedRecord | null {
  const categories = matchCategories(source.id, { modalidad: row.modalities }, mappings);
  if (categories.length === 0) return null;
  const entityType = entityTypeFor(row.kind, row.name);
  const finalCategories =
    entityType === "asociacion" ? [{ categoryId: "asociacion.federacion", priority: 300 }, ...categories] : categories;

  const address = cleanAddress(row.address);
  const nif = normalizeNif(row.nif);
  const phones = row.phones
    .map((raw) => ({ raw: raw.trim(), n: normalizePhone(raw) }))
    .filter((p): p is { raw: string; n: NonNullable<ReturnType<typeof normalizePhone>> } => p.n !== null)
    // Un móvil en el registro de un club suele ser el de un directivo: dato personal.
    .map((p) => ({ raw: p.raw, e164: p.n.e164, isPersonal: p.n.isMobile }))
    .filter((p, i, arr) => arr.findIndex((x) => x.e164 === p.e164) === i);
  const emails = row.emails
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    // Un correo de proveedor gratuito suele ser el de una persona del club: se marca como personal.
    .map((raw) => ({ raw, normalized: raw.toLowerCase(), isPersonal: FREE_MAIL.test(raw) }))
    .filter((e, i, arr) => arr.findIndex((x) => x.normalized === e.normalized) === i);
  const web = normalizeWebsite(row.web);
  const name = displayName(row.name);

  return {
    sourceId: source.id,
    externalId: row.externalId,
    payload: row.raw,
    sourceUrl: source.datasetUrl,
    entityType,
    name,
    normalizedName: normalizeName(name),
    categories: finalCategories,
    address: address ? { text: address, isPersonal: addressLooksPersonal(address) } : null,
    postalCode: normalizePostalCode(row.postalCode),
    municipalityCode,
    location: row.location
      ? { lon: row.location.lon, lat: row.location.lat, precision: "address", sourceId: source.id, method: "found", confidence: 0.7 }
      : null,
    phones,
    websites: web && row.web ? [{ raw: row.web.trim(), normalized: web }] : [],
    emails,
    identifiers: [
      { scheme: "registro", value: `${source.id}/${row.externalId}` },
      ...(nif ? [{ scheme: "nif" as const, value: nif }] : []),
    ],
    openingHours: null,
  };
}
