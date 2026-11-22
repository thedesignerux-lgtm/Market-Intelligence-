// Registro de Clubes Deportivos de Castilla y León (Junta de Castilla y León, datos abiertos, CC BY 4.0,
// actualización diaria de lunes a viernes). Un único CSV (separador «;», UTF-8) con una fila por club.
// Publica la localidad por nombre (sin código INE): se resuelve después contra los municipios de la base.
//
// Modalidades: cada una lleva un código de dos letras («CI003 CICLISMO - BICICLETA MONTAÑA (BTT)»).
// Se considera club de ciclismo el que tiene alguna modalidad con código CI: es más fiable que buscar
// «ciclismo» en el texto, que también aparece en MOTOCICLISMO y en las modalidades de deporte adaptado
// (un club de atletismo con 140 modalidades adaptadas no es un club ciclista). OR003 (orientación en BTT) no cuenta.

import { parse } from "csv-parse/sync";
import { CYCLING, fetchDaily, requireColumns, type RegistryRow, type RegistrySource } from "./common";

const URL = "https://datosabiertos.jcyl.es/web/jcyl/risp/es/deporte/clubes-deportivos/1284839616146.csv";
const C = {
  num: "Nº registro",
  name: "Nombre",
  address: "Domicilio",
  province: "Provincia",
  town: "Localidad",
  cp: "C.Postal",
  phone: "Teléfono",
  email: "Email",
  web: "Web",
  mods: "Deportes",
};
/** Ávila, Burgos, León, Palencia, Salamanca, Segovia, Soria, Valladolid, Zamora. */
const PROVINCES = ["05", "09", "24", "34", "37", "40", "42", "47", "49"];

/** ¿Es una modalidad de ciclismo según su código oficial (CI001…CI012)? */
export function isCyclingCode(modality: string): boolean {
  return /^\s*CI\d{3}\b/.test(modality);
}

export function parseCastillaLeon(text: string): RegistryRow[] {
  const records = parse(text, {
    delimiter: ";",
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];
  requireColumns("registro_castilla_leon", records[0], Object.values(C));
  return records.map((r) => {
    // Las modalidades vienen separadas por comas dentro de una sola celda.
    const mods = (r[C.mods] ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    const cp = r[C.cp]?.trim() || null;
    const prov = cp && /^\d{5}$/.test(cp) && PROVINCES.includes(cp.slice(0, 2)) ? cp.slice(0, 2) : null;
    return {
      externalId: r[C.num]!.trim(),
      name: r[C.name] ?? "",
      kind: "Club deportivo",
      nif: null,
      modalities: mods.some(isCyclingCode) ? [CYCLING, ...mods] : mods,
      address: r[C.address] || null,
      postalCode: cp,
      provinceCode: prov,
      municipalityCode: null,
      municipalityName: r[C.town] || null,
      phones: (r[C.phone] ?? "").split(/[\/;,]/).map((p) => p.trim()).filter(Boolean),
      emails: (r[C.email] ?? "").split(/[;,\s]+/).filter(Boolean),
      web: r[C.web] || null,
      location: null,
      raw: r,
    };
  });
}

export const castillaLeon: RegistrySource = {
  id: "registro_castilla_leon",
  provinces: PROVINCES,
  datasetUrl: "https://datosabiertos.jcyl.es/web/jcyl/set/es/deporte/clubes-deportivos/1284839616146",
  async load(config) {
    const { buf, version } = await fetchDaily(config, this.id, "clubes.csv", URL);
    return { rows: parseCastillaLeon(buf.toString("utf8")), version };
  },
};
