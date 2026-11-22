// Registro de Entidades Deportivas de la Comunidad de Madrid (datos abiertos, CC BY 4.0).
// Aviso: este fichero solo trae tipo de entidad, número, denominación y municipio. No publica
// la modalidad deportiva, así que el ciclismo se deduce del nombre de la entidad. Eso implica
// que no aparecen los clubes multideporte con sección de ciclismo cuyo nombre no lo menciona,
// y que puede colarse algún falso positivo. Cada ficha queda marcada con modalidad_inferida
// para que se distinga de los registros que sí publican la modalidad.

import { parse } from "csv-parse/sync";
import { CYCLING, fetchDaily, requireColumns, type RegistryRow, type RegistrySource } from "./common";

const PROVINCES = ["28"];

const URL =
  "https://datos.comunidad.madrid/dataset/3c0b0133-ffb6-4b87-a4ad-8b7bada94881/resource/a178d4b8-d8ac-402a-a768-7582fcb83052/download/spacm_entidades_deportivas.csv";

const C = { kind: "TIPO_ENTIDAD", num: "NUMERO", name: "DENOMINACION", muni: "MUNICIPIO" } as const;

/** El nombre menciona ciclismo. */
const CYCLING_NAME = /cicli|ciclo|bicicl|btt|mtb|bike|bmx|pedal|velo\s?club|gravel/i;
/** El nombre menciona motor: suele ser motociclismo, minimotos o karts. */
const MOTOR_NAME = /\bmoto|motor|mini-?bike|\bquad\b|\bkart|scooter|ciclomotor/i;
/** Ciclismo sin ninguna duda: rescata nombres que también mencionan motor ("CICLISTA TAM MOTOR"). */
const CYCLING_SURE = /\bciclis(ta|mo)|\bbicicl|\bbtt\b|\bmtb\b|\bcicloturis|\bbmx\b/i;

/** ¿El nombre de la entidad corresponde a un club de ciclismo? */
export function looksCycling(name: string): boolean {
  if (!CYCLING_NAME.test(name)) return false;
  if (MOTOR_NAME.test(name) && !CYCLING_SURE.test(name)) return false;
  return true;
}

export function parseMadrid(csv: string): RegistryRow[] {
  const rows = parse(csv, { columns: true, delimiter: ";", bom: true, relax_quotes: true, relax_column_count: true, trim: true }) as Record<string, string>[];
  requireColumns("registro_madrid", rows[0], [C.kind, C.num, C.name, C.muni]);
  const out: RegistryRow[] = [];
  for (const r of rows) {
    const name = (r[C.name] ?? "").trim();
    if (!name || !looksCycling(name)) continue;
    const kind = (r[C.kind] ?? "").trim() || "Club";
    const num = (r[C.num] ?? "").trim();
    if (!num) continue;
    out.push({
      // El número se repite entre tipos de entidad (hay Agrupación 1 y Club 1): la clave es tipo+número.
      externalId: `${kind}/${num}`,
      name,
      kind,
      nif: null,
      modalities: [CYCLING],
      address: null,
      postalCode: null,
      provinceCode: "28",
      municipalityCode: null,
      municipalityName: (r[C.muni] ?? "").trim() || null,
      phones: [],
      emails: [],
      web: null,
      location: null,
      raw: { ...r, modalidad_inferida: true, modalidad_inferida_de: "denominacion" },
    });
  }
  return out;
}

export const madrid: RegistrySource = {
  id: "registro_madrid",
  provinces: PROVINCES,
  datasetUrl: "https://datos.comunidad.madrid/dataset/registro-de-entidades-deportivas-de-la-comunidad-de-madrid",
  async load(config) {
    const { buf, version } = await fetchDaily(config, this.id, "entidades.csv", URL);
    const rows = parseMadrid(buf.toString("utf8"));
    if (rows.length === 0) throw new Error("registro_madrid: ninguna entidad de ciclismo; posible cambio de formato");
    return { rows, version };
  },
};
