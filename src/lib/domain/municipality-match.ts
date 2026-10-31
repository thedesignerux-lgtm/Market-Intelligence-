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

/** Pone delante el artículo que algunas fuentes escriben al final: "Hospitalet, l'" o "Sauzal (El)". */
function frontArticle(part: string): string {
  const comma = part.match(/^(.+?),\s*([^,]+)$/);
  if (comma && ARTICLES.has(clean(comma[2]!))) return `${comma[2]} ${comma[1]}`;
  const paren = part.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (paren && ARTICLES.has(clean(paren[2]!))) return `${paren[2]} ${paren[1]}`;
  return part;
}

/** Claves de comparación de un nombre: cada variante bilingüe, con y sin artículo inicial. */
export function municipalityKeys(name: string): string[] {
  const keys = new Set<string>();
  for (const raw of name.split(/\s*\/\s*|\s+-\s+/)) {
    const k = clean(frontArticle(raw));
    if (!k) continue;
    keys.add(k);
    const words = k.split(" ");
    if (words.length > 1 && ARTICLES.has(words[0]!)) keys.add(words.slice(1).join(" "));
  }
  return [...keys];
}

export type MunicipalityIndex = Map<string, string | null>;

/** Índice clave → código INE. Una clave compartida por dos municipios queda como ambigua (null). */
export function buildMunicipalityIndex(municipalities: { code: string; name: string }[]): MunicipalityIndex {
  const index: MunicipalityIndex = new Map();
  for (const m of municipalities) {
    for (const k of municipalityKeys(m.name)) {
      const prev = index.get(k);
      if (prev === undefined) index.set(k, m.code);
      else if (prev !== m.code) index.set(k, null);
    }
  }
  return index;
}

/** Código INE del municipio, o null si no se reconoce o es ambiguo. */
export function resolveMunicipality(index: MunicipalityIndex, name: string | null | undefined): string | null {
  if (!name) return null;
  let found: string | null = null;
  for (const k of municipalityKeys(name)) {
    const code = index.get(k);
    if (code === undefined) continue;
    if (code === null) return null;
    if (found && found !== code) return null;
    found = code;
  }
  return found;
}
