// Registre d'Entitats Esportives de Catalunya (Generalitat, portal de dades obertes, actualización semanal).
// Licencia: Llicència oberta d'ús d'informació - Catalunya (permite reutilización comercial citando la fuente).
// Publica el municipio por nombre (sin código INE): se resuelve después contra los municipios de la base.

import { parse } from "csv-parse/sync";
import { CYCLING, fetchDaily, isCyclingModality, requireColumns, type RegistryRow, type RegistrySource } from "./common";

const URL = "https://analisi.transparenciacatalunya.cat/api/v3/views/qrgc-u7pk/export.csv?accessType=DOWNLOAD";
const C = {
  num: "Número de registre",
  name: "Nom entitat",
  address: "Adreça",
  cp: "Codi postal",
  muni: "Municipi",
  phone: "Mòbil / Telèfon",
  email: "Correu electrònic",
  kind: "Tipus d’entitat",
  mods: "Modalitats",
};
const PROVINCES = ["08", "17", "25", "43"];

export function parseCataluna(text: string): RegistryRow[] {
  const records = parse(text, { bom: true, columns: true, skip_empty_lines: true, relax_quotes: true, trim: true }) as Record<string, string>[];
  requireColumns("registro_cataluna", records[0], Object.values(C));
  return records.map((r) => {
    const mods = (r[C.mods] ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    const cp = r[C.cp]?.trim() || null;
    const prov = cp && /^\d{5}$/.test(cp) && PROVINCES.includes(cp.slice(0, 2)) ? cp.slice(0, 2) : null;
    return {
      externalId: r[C.num]!.trim(),
      name: r[C.name] ?? "",
      kind: r[C.kind] ?? "",
      nif: null,
      modalities: mods.some(isCyclingModality) ? [CYCLING, ...mods] : mods,
      address: r[C.address] || null,
      postalCode: cp,
      provinceCode: prov,
      municipalityCode: null,
      municipalityName: r[C.muni] || null,
      phones: (r[C.phone] ?? "").split(/[\/;,]/).filter(Boolean),
      emails: (r[C.email] ?? "").split(/[;,\s]+/).filter(Boolean),
      web: null,
      location: null,
      raw: r,
    };
  });
}

export const cataluna: RegistrySource = {
  id: "registro_cataluna",
  provinces: PROVINCES,
  datasetUrl: "https://analisi.transparenciacatalunya.cat/d/qrgc-u7pk",
  async load(config) {
    const { buf, version } = await fetchDaily(config, this.id, "entitats.csv", URL);
    return { rows: parseCataluna(buf.toString("utf8")), version };
  },
};
