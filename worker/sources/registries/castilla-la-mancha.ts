// Listado del Registro de Entidades Deportivas de Castilla-La Mancha.
// La Junta no publica el registro como fichero, pero su ventanilla electrónica tiene un
// listado público que filtra por modalidad deportiva. Se consulta una vez por cada modalidad
// de ciclismo y se traduce la tabla de resultados.
// El listado devuelve número de registro, nombre, tipo, localidad y provincia: no publica
// dirección ni contacto, pero la modalidad sí la da el registro (no se deduce del nombre).

import { CYCLING, fetchDaily, type RegistryRow, type RegistrySource } from "./common";

const PROVINCES = ["02", "13", "16", "19", "45"];

const URL =
  "https://ventanillaelectronica.jccm.es/administracion_electronica/formularios/listadoRegistroEntidadesDeportivas.phtml";

/**
 * Modalidades de ciclismo del desplegable del listado. Se deja fuera CICLO INDOOR
 * (actividad de gimnasio) y, por supuesto, las de motociclismo.
 */
export const MODALITIES = [
  "CICLISMO",
  "CICLISMO CARRETERA",
  "CICLISMO EN PISTA",
  "CICLISMO EN TANDEM",
  "CICLISMO DS",
  "CICLISMO PC",
  "CICLO-CROSS",
  "CICLOTURISMO",
  "BMX",
  "TRIAL -BICI",
  "BICICLETA DE MONTAÑA (BTT)",
  "EN BICICLETA DE MONTAÑA",
];

/** Presupuesto de tiempo: si el listado va lento, mejor fallar que bloquear la importación entera. */
const BUDGET_MS = 20 * 60 * 1000;

const PROVINCE_BY_NAME: Record<string, string> = {
  albacete: "02",
  "ciudad real": "13",
  cuenca: "16",
  guadalajara: "19",
  toledo: "45",
};

/** El formulario trabaja en ISO-8859-1: hay que codificar los bytes, no los puntos de código UTF-8. */
export function latin1FormEncode(value: string): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9*\-._]/.test(ch)) out += ch;
    else if (ch === " ") out += "+";
    else {
      const code = ch.charCodeAt(0);
      out += code < 256 ? `%${code.toString(16).toUpperCase().padStart(2, "0")}` : encodeURIComponent(ch);
    }
  }
  return out;
}

function body(modality: string): string {
  return `NUMREG=&NOMBREENTI=&MODALIDAD=${latin1FormEncode(modality)}&BLANDDEP=&ORT01DEP=&LAND1DEP=&BUSCAR=Buscar`;
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Traduce la tabla de resultados del listado. */
export function parseCastillaLaMancha(html: string, modality: string): RegistryRow[] {
  const rows: RegistryRow[] = [];
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map(text);
    if (cells.length < 5) continue;
    const [num, name, kind, town, province] = cells as [string, string, string, string, string];
    if (!/^\d{6,10}$/.test(num)) continue;
    if (!name) continue;
    rows.push({
      externalId: num,
      name,
      kind: kind || "Club",
      nif: null,
      modalities: [CYCLING, modality.toUpperCase()].filter((m, i, a) => a.indexOf(m) === i),
      address: null,
      postalCode: null,
      provinceCode: PROVINCE_BY_NAME[province.toLowerCase()] ?? null,
      municipalityCode: null,
      municipalityName: town || null,
      phones: [],
      emails: [],
      web: null,
      location: null,
      raw: { numero: num, nombre: name, tipo: kind, localidad: town, provincia: province, modalidad: modality },
    });
  }
  return rows;
}

export const castillaLaMancha: RegistrySource = {
  id: "registro_castilla_la_mancha",
  provinces: PROVINCES,
  datasetUrl: URL,
  async load(config) {
    const start = Date.now();
    const byId = new Map<string, RegistryRow>();
    const versions: string[] = [];
    for (const modality of MODALITIES) {
      if (Date.now() - start > BUDGET_MS) {
        throw new Error(`${this.id}: el listado tarda demasiado (más de ${BUDGET_MS / 60000} min); se deja para la próxima importación`);
      }
      const name = `${modality.replace(/[^A-Za-z0-9]+/g, "_")}.html`;
      const { buf, version } = await fetchDaily(config, this.id, name, URL, 20 * 1024 * 1024, body(modality));
      const html = buf.toString("latin1");
      // El formulario sin resultados devuelve solo la cabecera: si no aparece, ha cambiado de formato.
      if (!/Nombre\s*Entidad/i.test(html)) {
        throw new Error(`${this.id}: el listado no trae la tabla esperada (modalidad ${modality})`);
      }
      const rows = parseCastillaLaMancha(html, modality);
      for (const row of rows) {
        const prev = byId.get(row.externalId);
        if (prev) {
          for (const m of row.modalities) if (!prev.modalities.includes(m)) prev.modalities.push(m);
        } else {
          byId.set(row.externalId, row);
        }
      }
      versions.push(`${modality}:${rows.length}@${version.slice(0, 10)}`);
    }
    if (byId.size === 0) throw new Error(`${this.id}: el listado no ha devuelto ninguna entidad de ciclismo`);
    return { rows: [...byId.values()], version: versions.join(",").slice(0, 200) };
  },
};
