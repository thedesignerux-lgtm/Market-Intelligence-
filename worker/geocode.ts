// Geocodificación con CartoCiudad (IGN). Licencia CC BY 4.0: se puede guardar el resultado con atribución.
//
// Reglas de calidad (ADR-0004):
// · Se rechaza el resultado si cae en otro municipio distinto del esperado.
// · La precisión la decidimos nosotros comparando el número pedido con el devuelto:
//   CartoCiudad devuelve el portal más cercano aunque no exista el pedido.
// · Si la dirección parece un domicilio particular, solo se geocodifica la calle (sin número)
//   para no situar en el mapa la vivienda de una persona.

import type { Db } from "./db";
import type { Config } from "./config";
import { userAgent } from "./config";
import { fetchWithRetry } from "./http";
import { searchNormalize } from "../src/lib/domain/normalize";
import { trigramSimilarity } from "../src/lib/domain/matching";
import type { LocationPrecision, RecordLocation } from "../src/lib/domain/records";

export interface GeocodeInput {
  address: string;
  postalCode: string | null;
  municipalityName: string;
  municipalityCode: string;
  streetOnly: boolean;
}

interface CartoCiudadResult {
  type?: string;
  address?: string;
  portalNumber?: number;
  muniCode?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
}

// Tipos de vía que no ayudan a identificar la calle (y que a veces vienen duplicados: "RUA RÚA DO...").
const STREET_TYPES = new Set([
  "rua", "r", "calle", "c", "cl", "avda", "avenida", "av", "praza", "plaza", "pza", "lugar", "lg", "rolda", "ronda",
  "camino", "camiño", "carretera", "ctra", "estrada", "travesia", "trav", "paseo", "rueiro", "costa", "campo", "rua",
]);

const ARTICLES = new Set(["do", "da", "dos", "das", "de", "del", "la", "las", "los", "el", "o", "a", "os", "as"]);

function streetTokens(address: string): string[] {
  const beforeNumber = address.split(/[,\d(]|\bs\/n\b/i)[0] ?? address;
  return searchNormalize(beforeNumber).split(" ").filter(Boolean);
}

/** Nombre de la calle para consultar: un solo tipo de vía, sin número ni piso ("RUA RÚA DO LIMPADOIRO S/N" → "rua do limpadoiro"). */
export function streetName(address: string): string {
  const tokens = streetTokens(address);
  let i = 0;
  while (i + 1 < tokens.length && STREET_TYPES.has(tokens[i]!) && STREET_TYPES.has(tokens[i + 1]!)) i++;
  return tokens.slice(i).join(" ");
}

/** Palabras significativas de una calle (sin tipo de vía ni artículos), para comparar. */
export function streetKey(address: string): string[] {
  return [...new Set(streetTokens(address).filter((t) => !STREET_TYPES.has(t) && !ARTICLES.has(t)))].sort();
}

/** ¿La calle devuelta es la pedida? Coincidencia de palabras significativas. */
export function sameStreet(wanted: string, got: string): boolean {
  const a = streetKey(wanted);
  const b = streetKey(got);
  if (a.length === 0 || b.length === 0) return false;
  const inter = a.filter((t) => b.includes(t)).length;
  const jaccard = inter / (a.length + b.length - inter);
  // Tolerante a erratas leves, pero "Vilar" ≠ "Vilar do Rei".
  return jaccard >= 0.6 || trigramSimilarity(a.join(" "), b.join(" ")) >= 0.75;
}

/** Calle sin número ni piso (para domicilios particulares o como último recurso). */
export function streetPart(address: string): string {
  return streetName(address);
}

/** Número de portal: el primero que aparece y no es un piso ("Rúa do Hórreo 54" → 54). */
export function requestedNumber(address: string): number | null {
  const m = address.match(/(?:^|[\s,])(\d{1,4})(?![\dºª°])/);
  return m?.[1] ? Number(m[1]) : null;
}

/** Consultas a probar, de más a menos precisa. El código postal se omite: empeora los resultados. */
export function buildQueries(input: GeocodeInput): { q: string; streetOnly: boolean }[] {
  const street = streetName(input.address);
  if (street.length < 3) return [];
  const number = input.streetOnly ? null : requestedNumber(input.address);
  const out: { q: string; streetOnly: boolean }[] = [];
  if (number !== null) out.push({ q: `${street} ${number}, ${input.municipalityName}`, streetOnly: false });
  out.push({ q: `${street}, ${input.municipalityName}`, streetOnly: true });
  return out;
}

export function precisionFor(input: GeocodeInput, result: CartoCiudadResult): LocationPrecision {
  const type = (result.type ?? "").toLowerCase();
  if (type === "portal" || type === "callejero" || type === "carretera") {
    if (input.streetOnly) return "street";
    const wanted = requestedNumber(input.address);
    if (wanted === null || result.portalNumber == null) return "street";
    return Math.abs(result.portalNumber - wanted) <= 4 ? "address" : "street";
  }
  if (type === "codpost") return "postal_code";
  if (type === "municipio" || type === "poblacion") return "municipality";
  // Topónimos, puntos de interés y otros tipos: aproximación de calle como mucho.
  return "street";
}

export class Geocoder {
  private lastCall = 0;
  stats = { requests: 0, cacheHits: 0, accepted: 0, rejected: 0 };

  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  private async throttle() {
    const wait = this.lastCall + this.config.GEOCODER_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
  }

  private async lookup(query: string): Promise<CartoCiudadResult | null> {
    const key = `cartociudad:${searchNormalize(query)}`;
    const cached = await this.db.query<{ result: CartoCiudadResult | null }>(
      "select result from public.geocode_cache where query_key = $1",
      [key],
    );
    if (cached.rowCount) {
      this.stats.cacheHits++;
      return cached.rows[0]!.result;
    }
    await this.throttle();
    this.stats.requests++;
    const url = `${this.config.CARTOCIUDAD_URL}?${new URLSearchParams({ q: query })}`;
    const res = await fetchWithRetry(url, { userAgent: userAgent(this.config), timeoutMs: 20_000, retries: 3 });
    const text = (await res.text()).trim();
    // Sin coincidencias CartoCiudad devuelve un cuerpo vacío.
    let result: CartoCiudadResult | null = text ? (JSON.parse(text) as CartoCiudadResult) : null;
    if (result && (typeof result.lat !== "number" || typeof result.lng !== "number")) result = null;
    await this.db.query(
      `insert into public.geocode_cache (query_key, provider, result) values ($1, 'cartociudad', $2)
       on conflict (query_key) do update set result = excluded.result, created_at = now()`,
      [key, result === null ? null : JSON.stringify(result)],
    );
    return result;
  }

  async geocode(input: GeocodeInput): Promise<RecordLocation | null> {
    for (const attempt of buildQueries(input)) {
      const result = await this.lookup(attempt.q);
      if (!result || result.lat == null || result.lng == null) continue;
      // Debe caer en el municipio esperado y en una calle con nombre parecido al pedido.
      if (result.muniCode && result.muniCode !== input.municipalityCode) continue;
      // Solo valen resultados de tipo calle/portal: un pueblo o topónimo con nombre parecido no es la dirección.
      const type = (result.type ?? "").toLowerCase();
      if (!["portal", "callejero", "carretera"].includes(type)) continue;
      if (!sameStreet(input.address, result.address ?? "")) continue;
      this.stats.accepted++;
      const precision = precisionFor({ ...input, streetOnly: attempt.streetOnly || input.streetOnly }, result);
      return {
        lon: result.lng,
        lat: result.lat,
        precision,
        sourceId: "cartociudad",
        method: "inferred",
        confidence: precision === "address" ? 0.7 : precision === "street" ? 0.5 : 0.3,
      };
    }
    this.stats.rejected++;
    return null;
  }
}
