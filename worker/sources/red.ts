// Rexistro de Entidades Deportivas de Galicia (Xunta). CSV con actualización diaria, licencia CC BY-SA 4.0.

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { Config } from "../config";
import { userAgent } from "../config";
import { fetchWithRetry } from "../http";
import { matchCategories, type CategoryMapping } from "../../src/lib/domain/categories";
import {
  addressLooksPersonal,
  cleanAddress,
  displayName,
  normalizeName,
  normalizeNif,
  normalizePhone,
  normalizePostalCode,
  normalizeWebsite,
} from "../../src/lib/domain/normalize";
import type { EntityType, NormalizedRecord } from "../../src/lib/domain/records";

export const RED_SOURCE_ID = "red_galicia";

export interface RedRow {
  numero: string;
  nif: string;
  denominacion: string;
  tipoEntidade: string;
  modalidades: string[];
  especialidades: string[];
  enderezo: string;
  cp: string;
  provinciaCodigo: string;
  provincia: string;
  concelloCodigo: string;
  concello: string;
  telefono1: string;
  telefono2: string;
  web: string;
  fechaAlta: string;
}

const COLUMN_MAP: Record<string, keyof RedRow> = {
  "NÚMERO": "numero",
  NIF: "nif",
  DENOMINACION: "denominacion",
  TIPO_ENTIDADE: "tipoEntidade",
  MODALIDADES: "modalidades",
  ESPECIALIDADES: "especialidades",
  ENDEREZO: "enderezo",
  CP: "cp",
  "CÓDIGO": "provinciaCodigo",
  PROVINCIA: "provincia",
  "CÓDIGO CONCELLO": "concelloCodigo",
  CONCELLO: "concello",
  "TELÉFONO 1": "telefono1",
  "TELÉFONO 2": "telefono2",
  "PÁXINA WEB": "web",
  FECHA_ALTA: "fechaAlta",
};

const splitList = (s: string) =>
  s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);

/** Interpreta el CSV. Falla de forma explícita si cambia la estructura del fichero. */
export function parseRedCsv(text: string): RedRow[] {
  const records = parse(text, {
    delimiter: ";",
    bom: true,
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  }) as Record<string, string>[];
  if (records.length === 0) throw new Error("El CSV del RED está vacío");
  const missing = Object.keys(COLUMN_MAP).filter((c) => !(c in records[0]!));
  if (missing.length) {
    throw new Error(`El CSV del RED ha cambiado de formato; faltan columnas: ${missing.join(", ")}`);
  }
  return records.map((r) => {
    const row = {} as Record<keyof RedRow, string | string[]>;
    for (const [col, key] of Object.entries(COLUMN_MAP)) {
      const v = r[col] ?? "";
      row[key] = key === "modalidades" || key === "especialidades" ? splitList(v) : v;
    }
    return row as unknown as RedRow;
  });
}

function entityTypeFor(tipo: string): EntityType {
  const t = tipo.toUpperCase();
  if (t.startsWith("FEDERACI") || t.includes("FEDERACIONES")) return "asociacion";
  return "club";
}

/** Convierte una fila al formato común. Devuelve null si no entra en ninguna categoría configurada. */
export function redRowToRecord(row: RedRow, mappings: CategoryMapping[], sourceUrl: string): NormalizedRecord | null {
  const categories = matchCategories(RED_SOURCE_ID, { modalidad: row.modalidades }, mappings);
  if (categories.length === 0) return null;
  const entityType = entityTypeFor(row.tipoEntidade);
  const finalCategories =
    entityType === "asociacion"
      ? [{ categoryId: "asociacion.federacion", priority: 300 }, ...categories]
      : categories;

  const address = cleanAddress(row.enderezo);
  const nif = normalizeNif(row.nif);
  const phones = [row.telefono1, row.telefono2]
    .map((raw) => ({ raw, n: normalizePhone(raw) }))
    .filter((p): p is { raw: string; n: NonNullable<ReturnType<typeof normalizePhone>> } => p.n !== null)
    // Un móvil en el registro de un club suele ser el de un directivo: dato personal.
    .map((p) => ({ raw: p.raw.trim(), e164: p.n.e164, isPersonal: p.n.isMobile }))
    .filter((p, i, arr) => arr.findIndex((x) => x.e164 === p.e164) === i);
  const web = normalizeWebsite(row.web);
  const name = displayName(row.denominacion);

  return {
    sourceId: RED_SOURCE_ID,
    externalId: row.numero.trim(),
    payload: { ...row },
    sourceUrl,
    entityType,
    name,
    normalizedName: normalizeName(name),
    categories: finalCategories,
    address: address ? { text: address, isPersonal: addressLooksPersonal(address) } : null,
    postalCode: normalizePostalCode(row.cp),
    municipalityCode: /^\d{5}$/.test(row.concelloCodigo) ? row.concelloCodigo : null,
    location: null,
    phones,
    websites: web ? [{ raw: row.web.trim(), normalized: web }] : [],
    emails: [],
    identifiers: [
      { scheme: "red_galicia", value: row.numero.trim() },
      ...(nif ? [{ scheme: "nif" as const, value: nif }] : []),
    ],
    openingHours: null,
  };
}

/** Descarga el CSV (una vez al día como máximo) y devuelve su contenido y versión. */
export async function fetchRedCsv(config: Config): Promise<{ text: string; version: string }> {
  const dir = path.join(config.CACHE_DIR, "red");
  await mkdir(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `red-${day}.csv`);
  let text: string;
  try {
    await stat(file);
    text = await readFile(file, "utf8");
  } catch {
    const res = await fetchWithRetry(config.RED_CSV_URL, { userAgent: userAgent(config), timeoutMs: 120_000 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 50 * 1024 * 1024) throw new Error("CSV del RED demasiado grande (>50 MB)");
    text = buf.toString("utf8");
    await writeFile(file, text);
  }
  const sha = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version: `${day}#${sha}` };
}
