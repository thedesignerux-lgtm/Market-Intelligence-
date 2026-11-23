// Selección territorial: traduce lo que elige la persona en el selector a códigos INE que
// entiende la consulta.
//
// Un código dice por sí mismo de qué nivel es:
//   "ca12"  → comunidad autónoma   "36"  → provincia   "36057" → municipio
// En la URL van separados por comas, y un guion delante significa «excluido»:
//   ?territorio=ca12,28,-28079   → toda Galicia y Madrid, menos el municipio de Madrid
//
// Las comunidades se expanden a sus provincias aquí, en el servidor, para que la consulta
// solo reciba provincias y municipios.

import { CCAA, PROVINCES } from "./territory";

export type TerritoryLevel = "ccaa" | "provincia" | "municipio";

export interface TerritoryPick {
  code: string;
  level: TerritoryLevel;
  /** Municipio quitado de una selección mayor. */
  excluded: boolean;
}

/** Nivel al que corresponde un código, o null si no es un código territorial válido. */
export function levelOf(code: string): TerritoryLevel | null {
  if (/^ca\d{2}$/.test(code)) return CCAA.some((c) => c.code === code) ? "ccaa" : null;
  if (/^\d{2}$/.test(code)) return PROVINCES.some((p) => p.code === code) ? "provincia" : null;
  if (/^\d{5}$/.test(code)) return PROVINCES.some((p) => p.code === code.slice(0, 2)) ? "municipio" : null;
  return null;
}

/** Lee el parámetro `territorio` de la URL. Ignora en silencio lo que no reconoce. */
export function parseTerritory(raw: string | string[] | undefined): TerritoryPick[] {
  const values = (Array.isArray(raw) ? raw : [raw])
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  const out: TerritoryPick[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const excluded = value.startsWith("-");
    const code = excluded ? value.slice(1) : value;
    const level = levelOf(code);
    if (!level) continue;
    // Solo se excluyen municipios: excluir una provincia entera es no seleccionarla.
    if (excluded && level !== "municipio") continue;
    const key = `${excluded ? "-" : ""}${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, level, excluded });
  }
  return out;
}

/** Vuelve a escribir la selección para la URL, en orden estable. */
export function serializeTerritory(picks: TerritoryPick[]): string | undefined {
  if (picks.length === 0) return undefined;
  const order = { ccaa: 0, provincia: 1, municipio: 2 } as const;
  const sorted = [...picks].sort(
    (a, b) => Number(a.excluded) - Number(b.excluded) || order[a.level] - order[b.level] || a.code.localeCompare(b.code),
  );
  return sorted.map((p) => `${p.excluded ? "-" : ""}${p.code}`).join(",");
}

export interface TerritoryQuery {
  /** Códigos de provincia (2 cifras) que entran enteros. */
  provinces: string[];
  /** Códigos de municipio (5 cifras) que entran suelos. */
  municipalities: string[];
  /** Municipios quitados de una selección mayor. */
  excluded: string[];
}

/**
 * Traduce la selección a lo que necesita `search_entities`.
 * - Una comunidad se convierte en sus provincias.
 * - Un municipio dentro de una provincia ya seleccionada se omite: sería redundante.
 * - Una exclusión solo cuenta si su provincia está seleccionada; si no, no hay nada que quitar.
 */
export function territoryQuery(picks: TerritoryPick[]): TerritoryQuery {
  const provinces = new Set<string>();
  for (const pick of picks.filter((p) => !p.excluded)) {
    if (pick.level === "ccaa") {
      for (const province of PROVINCES.filter((p) => p.ccaa === pick.code)) provinces.add(province.code);
    } else if (pick.level === "provincia") {
      provinces.add(pick.code);
    }
  }
  const municipalities = new Set<string>();
  for (const pick of picks.filter((p) => !p.excluded && p.level === "municipio")) {
    if (!provinces.has(pick.code.slice(0, 2))) municipalities.add(pick.code);
  }
  const excluded = new Set<string>();
  for (const pick of picks.filter((p) => p.excluded)) {
    if (provinces.has(pick.code.slice(0, 2))) excluded.add(pick.code);
  }
  return {
    provinces: [...provinces].sort(),
    municipalities: [...municipalities].sort(),
    excluded: [...excluded].sort(),
  };
}

/** Nombre de un código territorial, para los chips y el resumen. */
export function territoryName(code: string): string | undefined {
  return (
    CCAA.find((c) => c.code === code)?.name ??
    PROVINCES.find((p) => p.code === code)?.name ??
    undefined
  );
}

/** Ruta geográfica de un código, para que un municipio no sea ambiguo: Galicia → A Coruña. */
export function territoryPath(code: string): string[] {
  const level = levelOf(code);
  if (level === "ccaa") return [];
  const provinceCode = level === "provincia" ? code : code.slice(0, 2);
  const province = PROVINCES.find((p) => p.code === provinceCode);
  if (!province) return [];
  const ccaa = CCAA.find((c) => c.code === province.ccaa);
  return level === "provincia" ? [ccaa?.name ?? ""] : [ccaa?.name ?? "", province.name];
}

// ---------------------------------------------------------------------------
// Estado de selección para el selector. Puro, para poder probarlo sin interfaz.
// ---------------------------------------------------------------------------

/** "full": todo dentro; "partial": parte; "none": nada. */
export type Coverage = "full" | "partial" | "none";

const provincesOfCcaa = (ccaa: string) => PROVINCES.filter((p) => p.ccaa === ccaa).map((p) => p.code);
const ccaaOfProvince = (province: string) => PROVINCES.find((p) => p.code === province)?.ccaa;
const provinceOfMunicipality = (municipality: string) => municipality.slice(0, 2);

/** ¿El municipio entra por una selección de nivel superior (provincia o comunidad)? */
export function coveredByAncestor(picks: TerritoryPick[], municipality: string): boolean {
  const province = provinceOfMunicipality(municipality);
  const ccaa = ccaaOfProvince(province);
  return picks.some(
    (p) => !p.excluded && ((p.level === "provincia" && p.code === province) || (p.level === "ccaa" && p.code === ccaa)),
  );
}

export function ccaaCoverage(picks: TerritoryPick[], ccaa: string): Coverage {
  const provinces = provincesOfCcaa(ccaa);
  const inside = (code: string) => provinces.includes(provinceOfMunicipality(code));
  const selectedCcaa = picks.some((p) => !p.excluded && p.level === "ccaa" && p.code === ccaa);
  const selectedProvinces = picks.filter((p) => !p.excluded && p.level === "provincia" && provinces.includes(p.code));
  const selectedMunicipalities = picks.filter((p) => !p.excluded && p.level === "municipio" && inside(p.code));
  const exclusions = picks.filter((p) => p.excluded && inside(p.code));
  if (selectedCcaa) return exclusions.length > 0 ? "partial" : "full";
  if (selectedProvinces.length === provinces.length && provinces.length > 0 && exclusions.length === 0) return "full";
  if (selectedProvinces.length > 0 || selectedMunicipalities.length > 0) return "partial";
  return "none";
}

export function provinceCoverage(picks: TerritoryPick[], province: string): Coverage {
  const ccaa = ccaaOfProvince(province);
  const covered = picks.some(
    (p) => !p.excluded && ((p.level === "provincia" && p.code === province) || (p.level === "ccaa" && p.code === ccaa)),
  );
  const exclusions = picks.filter((p) => p.excluded && provinceOfMunicipality(p.code) === province);
  const municipalities = picks.filter(
    (p) => !p.excluded && p.level === "municipio" && provinceOfMunicipality(p.code) === province,
  );
  if (covered) return exclusions.length > 0 ? "partial" : "full";
  if (municipalities.length > 0) return "partial";
  return "none";
}

export function municipalityCoverage(picks: TerritoryPick[], municipality: string): Coverage {
  if (picks.some((p) => p.excluded && p.code === municipality)) return "none";
  if (picks.some((p) => !p.excluded && p.level === "municipio" && p.code === municipality)) return "full";
  return coveredByAncestor(picks, municipality) ? "full" : "none";
}

/** Quita de la selección todo lo que cuelgue de una comunidad. */
function withoutCcaa(picks: TerritoryPick[], ccaa: string): TerritoryPick[] {
  const provinces = provincesOfCcaa(ccaa);
  return picks.filter((p) => {
    if (p.level === "ccaa") return p.code !== ccaa;
    if (p.level === "provincia") return !provinces.includes(p.code);
    return !provinces.includes(provinceOfMunicipality(p.code));
  });
}

/** Quita de la selección todo lo que cuelgue de una provincia. */
function withoutProvince(picks: TerritoryPick[], province: string): TerritoryPick[] {
  return picks.filter((p) => {
    if (p.level === "provincia") return p.code !== province;
    if (p.level === "municipio") return provinceOfMunicipality(p.code) !== province;
    return true;
  });
}

/**
 * Deshace la selección de una comunidad dejando sus demás provincias seleccionadas.
 * Hace falta para que quitar una provincia de «Galicia completa» deje las otras tres.
 */
function expandCcaa(picks: TerritoryPick[], ccaa: string, except: string): TerritoryPick[] {
  if (!picks.some((p) => !p.excluded && p.level === "ccaa" && p.code === ccaa)) return picks;
  const rest = provincesOfCcaa(ccaa)
    .filter((code) => code !== except)
    .map<TerritoryPick>((code) => ({ code, level: "provincia", excluded: false }));
  return [...picks.filter((p) => !(p.level === "ccaa" && p.code === ccaa)), ...rest];
}

/**
 * Marca o desmarca una comunidad. Como en cualquier árbol con casillas, pulsar una casilla
 * a medias selecciona el territorio entero; solo se vacía cuando ya estaba completo.
 */
export function toggleCcaa(picks: TerritoryPick[], ccaa: string): TerritoryPick[] {
  const clean = withoutCcaa(picks, ccaa);
  return ccaaCoverage(picks, ccaa) === "full" ? clean : [...clean, { code: ccaa, level: "ccaa", excluded: false }];
}

export function toggleProvince(picks: TerritoryPick[], province: string): TerritoryPick[] {
  const ccaa = ccaaOfProvince(province);
  if (provinceCoverage(picks, province) === "full") {
    // Al quitarla, si entraba por su comunidad hay que desgranar la comunidad en las demás.
    return withoutProvince(ccaa ? expandCcaa(picks, ccaa, province) : picks, province);
  }
  // Al seleccionarla entera se quitan los municipios y las exclusiones de dentro. Si ya entra
  // por su comunidad, con quitar las exclusiones queda completa: no hace falta añadirla.
  const cleaned = withoutProvince(picks, province);
  const alreadyByCcaa = cleaned.some((p) => !p.excluded && p.level === "ccaa" && p.code === ccaa);
  return alreadyByCcaa ? cleaned : [...cleaned, { code: province, level: "provincia", excluded: false }];
}

export function toggleMunicipality(picks: TerritoryPick[], municipality: string): TerritoryPick[] {
  const excluded = picks.find((p) => p.excluded && p.code === municipality);
  if (excluded) return picks.filter((p) => p !== excluded);
  const own = picks.find((p) => !p.excluded && p.level === "municipio" && p.code === municipality);
  if (own) return picks.filter((p) => p !== own);
  if (coveredByAncestor(picks, municipality)) {
    return [...picks, { code: municipality, level: "municipio", excluded: true }];
  }
  return [...picks, { code: municipality, level: "municipio", excluded: false }];
}

/** Quita un elemento concreto de la selección (la × de un chip). */
export function removePick(picks: TerritoryPick[], code: string): TerritoryPick[] {
  const level = levelOf(code);
  if (level === "ccaa") return withoutCcaa(picks, code);
  if (level === "provincia") return toggleProvince(picks, code);
  return picks.filter((p) => p.code !== code);
}
