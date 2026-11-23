// Registro de Clubes Deportivos de Castilla y León (Junta de Castilla y León, datos abiertos, CC BY 4.0,
// actualización diaria de lunes a viernes). Un único CSV (separador «;», UTF-8) con una fila por club.
// Publica la localidad por nombre (sin código INE): se resuelve después contra los municipios de la base.
//
// Modalidades: cada una lleva un código de dos letras («CI003 CICLISMO - BICICLETA MONTAÑA (BTT)»).
// Se considera club de ciclismo el que tiene alguna modalidad con código CI: es más fiable que buscar
// «ciclismo» en el texto, que también aparece en MOTOCICLISMO y en las modalidades de deporte adaptado
// (un club de atletismo con 140 modalidades adaptadas no es un club ciclista). OR003 (orientación en BTT) no cuenta.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";
import { CYCLING, fetchDaily, requireColumns, type RegistryRow, type RegistrySource } from "./common";

const URL = "https://datosabiertos.jcyl.es/web/jcyl/risp/es/deporte/clubes-deportivos/1284839616146.csv";

/**
 * Copia de respaldo con solo los clubes de ciclismo, descargada a mano el 23/11/2026.
 * datosabiertos.jcyl.es no es accesible desde los servidores donde corre el importador
 * (ni GitHub Actions ni el entorno de trabajo llegan: «fetch failed»), así que sin este
 * respaldo la fuente no entra. Se usa solo cuando falla la descarga, y entonces la versión
 * del import deja constancia de que son datos congelados en esa fecha.
 */
const BACKUP_FILE = "castilla-leon-ciclismo-2026-11-23.csv";
const BACKUP_DATE = "2026-11-23";
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
    try {
      const { buf, version } = await fetchDaily(config, this.id, "clubes.csv", URL);
      return { rows: parseCastillaLeon(buf.toString("utf8")), version };
    } catch (error) {
      // Si la Junta no es accesible, se usa la copia de respaldo del repositorio en lugar de
      // dejar la comunidad sin clubes. La versión avisa de que los datos están congelados.
      const path = join(dirname(fileURLToPath(import.meta.url)), "data", BACKUP_FILE);
      const csv = readFileSync(path, "utf8");
      const rows = parseCastillaLeon(csv);
      console.warn(
        `[${castillaLeon.id}] no se ha podido descargar de la Junta (${(error as Error).message}); ` +
          `se usa la copia de respaldo de ${BACKUP_DATE} con ${rows.length} clubes`,
      );
      return { rows, version: `respaldo-${BACKUP_DATE}` };
    }
  },
};
