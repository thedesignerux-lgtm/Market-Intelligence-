// Emparejar nombres de municipio escritos por una fuente con los municipios de la base (códigos INE).
// Las fuentes escriben el mismo municipio de muchas formas: "Hospitalet de Llobregat, l'",
// "L'Hospitalet de Llobregat", "Pamplona/Iruña", "Palmas de Gran Canaria (Las)"…

import { fold } from "./normalize";

const ARTICLES = new Set(["el", "la", "los", "las", "l", "les", "els", "o", "a", "os", "as", "lo"]);

function clean(s: string): string {
  return fold(s)
    .replace(/[’'`´]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Pone delante el artículo que algunas fuentes escriben al final: "Hospitalet, l'", "Sauzal (El)", "Espluga de Francolí l'". */
function frontArticle(part: string): string {
  const comma = part.match(/^(.+?),\s*([^,]+)$/);
  if (comma && ARTICLES.has(clean(comma[2]!))) return `${comma[2]} ${comma[1]}`;
  const paren = part.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (paren && ARTICLES.has(clean(paren[2]!))) return `${paren[2]} ${paren[1]}`;
  const apostrophe = part.match(/^(.+?)\s+(l['’])$/i);
  if (apostrophe) return `${apostrophe[2]} ${apostrophe[1]}`;
  return part;
}

function withAndWithoutArticle(keys: Set<string>, k: string) {
  if (!k) return;
  keys.add(k);
  const words = k.split(" ");
  if (words.length > 1 && ARTICLES.has(words[0]!)) keys.add(words.slice(1).join(" "));
}

/** Claves de comparación de un nombre: cada variante bilingüe, con y sin artículo inicial. */
export function municipalityKeys(name: string): string[] {
  const keys = new Set<string>();
  for (const raw of name.split(/\s*\/\s*|\s+-\s+/)) withAndWithoutArticle(keys, clean(frontArticle(raw)));
  return [...keys];
}

/** Partes de un nombre compuesto con guion sin espacios ("Estella-Lizarra" → estella, lizarra). */
function hyphenPartKeys(name: string): string[] {
  const keys = new Set<string>();
  for (const raw of name.split(/\s*\/\s*|\s+-\s+/)) {
    if (!/\S-\S/.test(raw)) continue;
    for (const part of raw.split("-")) withAndWithoutArticle(keys, clean(frontArticle(part)));
  }
  return [...keys];
}

export interface MunicipalityIndex {
  /** Nombre completo (y sus variantes bilingües) → código INE; null si lo comparten varios municipios. */
  names: Map<string, string | null>;
  /** Partes de nombres compuestos con guion; solo se consultan si el nombre completo no aparece. */
  parts: Map<string, string | null>;
}

function put(map: Map<string, string | null>, key: string, code: string) {
  const prev = map.get(key);
  if (prev === undefined) map.set(key, code);
  else if (prev !== code) map.set(key, null);
}

/** Índice de municipios. Una clave compartida por dos municipios queda como ambigua y nunca se usa. */
export function buildMunicipalityIndex(municipalities: { code: string; name: string }[]): MunicipalityIndex {
  const index: MunicipalityIndex = { names: new Map(), parts: new Map() };
  for (const m of municipalities) {
    for (const k of municipalityKeys(m.name)) put(index.names, k, m.code);
    for (const k of hyphenPartKeys(m.name)) put(index.parts, k, m.code);
  }
  return index;
}

function lookup(map: Map<string, string | null>, keys: string[]): string | null | undefined {
  let found: string | undefined;
  for (const k of keys) {
    const code = map.get(k);
    if (code === undefined) continue;
    if (code === null) return null;
    if (found && found !== code) return null;
    found = code;
  }
  return found;
}

/** Código INE del municipio, o null si no se reconoce o es ambiguo. */
export function resolveMunicipality(index: MunicipalityIndex, name: string | null | undefined): string | null {
  if (!name) return null;
  const keys = municipalityKeys(name);
  const byName = lookup(index.names, keys);
  if (byName !== undefined) return byName;
  // El nombre completo no existe: se prueba con las partes de nombres compuestos ("Estella" → "Estella-Lizarra"),
  // salvo que esa clave sea el nombre completo de otro municipio.
  return lookup(index.parts, keys) ?? null;
}

/**
 * Código postal → municipio, aprendido de las filas ya resueltas de la misma fuente.
 * Solo se guardan códigos postales que en esas filas apuntan siempre al mismo municipio.
 */
export function postalCodeIndex(resolved: { postalCode: string | null; code: string }[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const r of resolved) {
    if (!r.postalCode || !/^\d{5}$/.test(r.postalCode)) continue;
    put(seen, r.postalCode, r.code);
  }
  return new Map([...seen].filter((e): e is [string, string] => e[1] !== null));
}
