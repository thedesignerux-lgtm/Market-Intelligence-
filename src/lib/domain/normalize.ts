// Normalización de datos de entidades.
// Funciones puras (sin acceso a red ni base de datos) para poder probarlas con tests.

import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/** Quita acentos y pasa a minúsculas. "Coruña" → "coruna". */
export function fold(input: string): string {
  return input.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Igual que public.search_normalize en la base de datos: solo letras/números y espacios simples. */
export function searchNormalize(input: string): string {
  return fold(input).replace(/[^a-z0-9]+/g, " ").trim();
}

// Formas jurídicas y palabras genéricas que no ayudan a distinguir una entidad de otra.
// Se mantienen en castellano y gallego. Se aplican sobre texto ya normalizado.
const LEGAL_FORMS = [
  "s l u", "s l", "sl", "slu", "s a", "sa", "s c", "sc", "s coop", "c b", "cb", "s l l", "sll",
  "sociedad limitada", "sociedad anonima", "sociedade limitada",
];
const STOPWORDS = new Set([
  "club", "clube", "c", "cd", "c d", "sd", "s d", "csd", "ad", "a d", "deportivo", "deportiva", "deportiva", "desportivo",
  "asociacion", "asociacion", "asociacions", "asociacions", "agrupacion", "seccion", "sociedad", "sociedade",
  "cultural", "recreativa", "recreativo",
  "de", "del", "la", "las", "los", "el", "do", "da", "dos", "das", "o", "a", "os", "as", "e", "y", "en",
  "team", "equipo",
]);
// Palabras de la vertical: no se eliminan del nombre visible, pero pesan menos al comparar.
export const DOMAIN_WORDS = new Set([
  "ciclista", "ciclismo", "bici", "bicis", "bicicleta", "bicicletas", "bike", "bikes", "cycling",
  "btt", "mtb", "tienda", "taller",
]);

/** Nombre normalizado para ordenar, buscar y deduplicar. */
export function normalizeName(name: string): string {
  let s = ` ${searchNormalize(name)} `;
  for (const lf of LEGAL_FORMS) {
    s = s.replaceAll(` ${lf} `, " ");
  }
  const tokens = s.trim().split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
  const out = tokens.join(" ");
  // Si al quitar palabras vacías no queda nada ("Club Deportivo"), se conserva el nombre plegado.
  return out || searchNormalize(name);
}

/** Tokens distintivos de un nombre (sin palabras de la vertical). */
export function distinctiveTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length > 1 && !DOMAIN_WORDS.has(t));
}

/** Nombre legible: los registros oficiales suelen venir EN MAYÚSCULAS. */
export function displayName(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  const letters = trimmed.replace(/[^\p{L}]/gu, "");
  const isAllCaps = letters.length > 3 && letters === letters.toUpperCase();
  if (!isAllCaps) return trimmed;
  const lowerWords = new Set(["de", "del", "la", "las", "los", "el", "do", "da", "dos", "das", "e", "y", "en", "o", "a", "os", "as"]);
  const keepUpper = /^(?:[A-Z]\.){1,4}[A-Z]?\.?$|^(?:BTT|MTB|CD|SD|CF|CC|AD|SL|SA|USC|BMX|XC)$/;
  return trimmed
    .split(" ")
    .map((w, i) => {
      if (keepUpper.test(w)) return w;
      const lw = w.toLocaleLowerCase("es");
      if (i > 0 && lowerWords.has(lw)) return lw;
      return lw.replace(/(^|[-'’(])(\p{L})/gu, (_m, p: string, c: string) => p + c.toLocaleUpperCase("es"));
    })
    .join(" ");
}

export interface NormalizedPhone {
  e164: string;
  isMobile: boolean;
}

/** Teléfono español en formato E.164 (+34...). Devuelve null si no es válido. */
export function normalizePhone(raw: string | null | undefined): NormalizedPhone | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.length < 9) return null;
  const parsed = parsePhoneNumberFromString(cleaned, "ES");
  if (!parsed || !parsed.isValid()) return null;
  const type = parsed.getType();
  return { e164: parsed.number, isMobile: type === "MOBILE" };
}

/** Dominio de una web ("https://www.Ejemplo.es/contacto" → "ejemplo.es"). Null si no es una URL válida. */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const url = new URL(s);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
    // Las redes sociales no identifican a una entidad por dominio: se guarda la URL completa.
    if (/(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|linkedin|strava|wa)\.(com|me)$/.test(host)) {
      return `${host}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    }
    return host;
  } catch {
    return null;
  }
}

export function normalizePostalCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 4) return `0${digits}`;
  return /^\d{5}$/.test(digits) && Number(digits.slice(0, 2)) >= 1 && Number(digits.slice(0, 2)) <= 52 ? digits : null;
}

/** NIF/CIF normalizado (mayúsculas, sin separadores). Validación de forma, no de dígito de control. */
export function normalizeNif(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]\d{7}[A-Z0-9]$/.test(s) ? s : null;
}

/**
 * ¿Parece un domicilio particular? (piso, puerta, "izq", "dcha"...).
 * Los clubes a menudo usan el domicilio de un directivo como sede: es un dato personal.
 */
export function addressLooksPersonal(address: string): boolean {
  const a = fold(address);
  return (
    // "1ºD", "4º", "2ª"
    /\d+\s*[ºª°]/.test(address) ||
    // "6IZQ", "3 dcha", "piso", "puerta" (también pegado al número)
    /(\b|\d)(izq\w*|izd\w*|dch\w*|drch\w*|derec\w*|dereit\w*|dta|esq\w*|piso|puerta|porta)\b/.test(a) ||
    // "12-3B"
    /\b\d+\s*-\s*\d+\s*[a-z]\b/.test(a)
  );
}

/** Limpia una dirección para mostrarla y geocodificarla. */
export function cleanAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  return s.length >= 3 ? s : null;
}
