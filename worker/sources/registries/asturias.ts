// Guía de clubes del Principado de Asturias (portal Deporte Asturiano).
// Asturias no publica el registro como fichero ni tiene buscador, pero su guía de clubes es
// una página con las tablas completas: denominación, dirección, CP, localidad, municipio,
// correo y modalidades deportivas. La modalidad la publica la guía, no se deduce del nombre.
// La guía no trae número de registro, así que el identificador se compone del nombre y el CP.

import { CYCLING, fetchDaily, isCyclingModality, type RegistryRow, type RegistrySource } from "./common";

const PROVINCES = ["33"];

const URL = "https://deporte.asturias.es/guia-de-clubes";

/** Encabezado que precede a cada tabla → tipo de entidad. */
const KIND_BY_HEADING: Record<string, string> = {
  "clubes basicos deportivos": "Club deportivo básico",
  "equipos deportivos": "Equipo deportivo",
  "sociedades anonimas deportivas": "Sociedad anónima deportiva",
};

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Traduce las tablas de la guía. Cada tabla va precedida por el encabezado que dice su tipo. */
export function parseAsturias(html: string): RegistryRow[] {
  const rows: RegistryRow[] = [];
  const seen = new Set<string>();
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  for (const table of tables) {
    const before = html.slice(Math.max(0, table.index! - 1500), table.index!);
    const headings = [...before.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => text(m[1] ?? ""));
    const heading = (headings[headings.length - 1] ?? "").toLowerCase();
    const kind = KIND_BY_HEADING[heading];
    if (!kind) continue; // tablas que no son de la guía (avisos de cookies, por ejemplo)
    for (const tr of table[0].match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = (tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map(text);
      if (cells.length < 7) continue;
      const [name, address, cp, town, municipality, email, modalities] = cells as string[];
      if (!name || /^denominaci/i.test(name)) continue;
      const mods = (modalities ?? "")
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const normalized = [...new Set(mods.map((m) => (isCyclingModality(m) ? CYCLING : m.toUpperCase())))];
      if (!normalized.includes(CYCLING)) continue;
      const postalCode = /^\d{5}$/.test(cp ?? "") ? cp! : null;
      const externalId = `${slug(name)}-${postalCode ?? slug(municipality ?? "")}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      rows.push({
        externalId,
        name,
        kind,
        nif: null,
        modalities: normalized,
        address: address || null,
        postalCode,
        provinceCode: "33",
        municipalityCode: null,
        municipalityName: municipality || town || null,
        phones: [],
        emails: email && email.includes("@") ? [email] : [],
        web: null,
        location: null,
        raw: { denominacion: name, direccion: address, cp, localidad: town, municipio: municipality, email, modalidades: modalities, tipo: kind },
      });
    }
  }
  return rows;
}

export const asturias: RegistrySource = {
  id: "registro_asturias",
  provinces: PROVINCES,
  datasetUrl: URL,
  async load(config) {
    const { buf, version } = await fetchDaily(config, this.id, "guia-de-clubes.html", URL, 20 * 1024 * 1024);
    const html = buf.toString("utf8");
    if (!/MODALIDADES_DEPORTIVAS/i.test(html)) {
      throw new Error(`${this.id}: la guía no trae la columna de modalidades; posible cambio de formato`);
    }
    const rows = parseAsturias(html);
    if (rows.length === 0) throw new Error(`${this.id}: la guía no ha devuelto ningún club de ciclismo`);
    return { rows, version };
  },
};
