// Registro Andaluz de Entidades Deportivas (RAED), Junta de Andalucía.
// El registro es público y se consulta por deporte en el buscador de la Consejería; no hay
// descarga en el portal de datos abiertos, así que se leen las páginas de resultados del
// propio buscador (una consulta por modalidad de ciclismo) y se traducen a RegistryRow.
// Procedencia y condiciones: https://www.juntadeandalucia.es/organismos/culturaydeporte/areas/deporte/entidades-deportivas/registro-entidades-deportivas.html

import { CYCLING, fetchDaily, isCyclingModality, type RegistryRow, type RegistrySource } from "./common";

const PROVINCES = ["04", "11", "14", "18", "21", "23", "29", "41"];

const BASE = "https://www.juntadeandalucia.es/deporte/dpweb/buscadorRaed/result";
/** El buscador agota el tiempo de espera con páginas grandes; 200 filas por página va bien. */
const PAGE = 200;
const MAX_PAGES = 60;

/** Códigos del desplegable «deporte» del buscador que son ciclismo. */
export const SPORT_CODES: Record<string, string> = {
  "23192": "CICLISMO",
  "23280": "MOUNTAIN BIKE",
  "23194": "CICLOTURISMO",
  "23524": "BICICLETA",
  "23843": "BMX",
  "23917": "CICLO-CROSS",
};

/** Nombre de provincia tal como lo escribe el registro → código INE. */
const PROVINCE_BY_NAME: Record<string, string> = {
  almeria: "04",
  cadiz: "11",
  cordoba: "14",
  granada: "18",
  huelva: "21",
  jaen: "23",
  malaga: "29",
  sevilla: "41",
};

function pageUrl(sportCode: string, offset: number): string {
  const q = new URLSearchParams({
    tiposentidad: "",
    provincia: "",
    deporte: sportCode,
    municipio: "",
    denominacion: "",
    numeroRegistro: "",
    offset: String(offset),
    max: String(PAGE),
  });
  return `${BASE}?${q.toString()}`;
}

function text(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Etiquetas de la ficha de detalle, en el orden en que las publica el buscador. */
const LABELS = [
  "Fecha inscripción",
  "Dirección",
  "Provincia",
  "Municipio",
  "C.P.",
  "Teléfono",
  "Fax",
  "Email",
  "Entidad",
  "Deporte",
  "Fecha modificación estatuto",
  "Otros deportes",
] as const;

type Detail = Partial<Record<(typeof LABELS)[number], string>>;

function clean(value: string): string | undefined {
  const v = value
    .replace(/\|?\s*Descargar Estatutos\s*$/i, "")
    .trim()
    .replace(/^[|;,\s]+|[|;,\s]+$/g, "");
  return v === "" || /^-+$/.test(v) ? undefined : v;
}

/** Parte la ficha de detalle en sus campos buscando las etiquetas. */
export function parseDetail(detail: string): Detail {
  const found: { at: number; end: number; label: (typeof LABELS)[number] }[] = [];
  for (const label of LABELS) {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:");
    const m = re.exec(detail);
    if (m) found.push({ at: m.index, end: m.index + m[0].length, label });
  }
  found.sort((a, b) => a.at - b.at);
  const out: Detail = {};
  found.forEach((f, i) => {
    const to = i + 1 < found.length ? found[i + 1]!.at : detail.length;
    const value = clean(detail.slice(f.end, to));
    if (value !== undefined && out[f.label] === undefined) out[f.label] = value;
  });
  return out;
}

/** Modalidades de la ficha: el deporte principal y los «otros deportes». */
function modalitiesOf(d: Detail): string[] {
  const raw = [d["Deporte"] ?? "", ...(d["Otros deportes"] ?? "").replace(/[[\]]/g, "").split(",")]
    .map((m) => m.trim())
    .filter((m) => m !== "" && !/^-+$/.test(m));
  const out = new Set<string>();
  for (const m of raw) out.add(isCyclingModality(m) ? CYCLING : m.toUpperCase());
  return [...out];
}

function provinceCodeOf(d: Detail): string | null {
  const cp = (d["C.P."] ?? "").trim();
  if (/^\d{5}$/.test(cp) && PROVINCES.includes(cp.slice(0, 2))) return cp.slice(0, 2);
  const name = (d["Provincia"] ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return PROVINCE_BY_NAME[name] ?? null;
}

/** Total de resultados que anuncia el buscador ("1 a 200 de 1376 resultados"). */
export function parseTotal(html: string): number | null {
  const m = /(\d+)\s+a\s+(\d+)\s+de\s+(\d+)\s+resultados/.exec(html);
  return m ? Number(m[3]) : null;
}

/** Traduce una página de resultados del buscador del RAED. */
export function parseAndalucia(html: string): RegistryRow[] {
  const rows: RegistryRow[] = [];
  let header: { numero: string; name: string; municipio: string } | null = null;
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map(text);
    if (cells.length >= 4 && /^\d{4,8}$/.test(cells[1] ?? "")) {
      header = { numero: cells[1]!, name: cells[2] ?? "", municipio: cells[3] ?? "" };
      continue;
    }
    const detail = cells.join(" ");
    if (!header || !detail.includes("Fecha inscripción")) continue;
    const d = parseDetail(detail);
    const modalities = modalitiesOf(d);
    if (!modalities.includes(CYCLING)) {
      header = null;
      continue;
    }
    rows.push({
      externalId: header.numero,
      name: header.name,
      kind: d["Entidad"] ?? "Club deportivo",
      nif: null,
      modalities,
      address: d["Dirección"] ?? null,
      postalCode: d["C.P."] ?? null,
      provinceCode: provinceCodeOf(d),
      municipalityCode: null,
      municipalityName: d["Municipio"] ?? (header.municipio || null),
      phones: d["Teléfono"] ? [d["Teléfono"]] : [],
      emails: d["Email"] ? [d["Email"]] : [],
      web: null,
      location: null,
      raw: { numero: header.numero, denominacion: header.name, ...d },
    });
    header = null;
  }
  return rows;
}

export const andalucia: RegistrySource = {
  id: "registro_andalucia",
  provinces: PROVINCES,
  datasetUrl:
    "https://www.juntadeandalucia.es/organismos/culturaydeporte/areas/deporte/entidades-deportivas/registro-entidades-deportivas.html",
  async load(config) {
    const byId = new Map<string, RegistryRow>();
    const versions: string[] = [];
    for (const sportCode of Object.keys(SPORT_CODES)) {
      let offset = 0;
      let expected: number | null = null;
      let seen = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { buf, version } = await fetchDaily(
          config,
          this.id,
          `${sportCode}-${offset}.html`,
          pageUrl(sportCode, offset),
          8 * 1024 * 1024,
        );
        const html = buf.toString("utf8");
        const total = parseTotal(html);
        if (page === 0) {
          if (total === null) {
            throw new Error(
              `${this.id}: el buscador no devuelve el número de resultados para el deporte ${sportCode}; posible cambio de formato`,
            );
          }
          expected = total;
          versions.push(`${sportCode}:${total}@${version}`);
        }
        const rows = parseAndalucia(html);
        const detalles = (html.match(/Fecha inscripción/g) ?? []).length;
        if (detalles === 0 && (expected ?? 0) > 0) {
          throw new Error(`${this.id}: página vacía con ${expected} resultados esperados (deporte ${sportCode})`);
        }
        for (const row of rows) if (!byId.has(row.externalId)) byId.set(row.externalId, row);
        seen += detalles;
        if (seen >= (expected ?? 0) || detalles < PAGE) break;
        offset += PAGE;
      }
    }
    if (byId.size === 0) throw new Error(`${this.id}: el buscador no ha devuelto ninguna entidad de ciclismo`);
    return { rows: [...byId.values()], version: versions.join(",").slice(0, 200) };
  },
};
