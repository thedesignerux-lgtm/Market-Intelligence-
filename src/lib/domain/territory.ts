// Territorio de España: comunidades autónomas y provincias con códigos INE.
// `extract` es la ruta del extracto provincial de OpenStreetMap en download.openstreetmap.fr/extracts
// (sin el sufijo "-latest.osm.pbf"). Canarias, Ceuta y Melilla están bajo "africa/spain".

export interface Ccaa {
  code: string; // "ca12"
  name: string;
  slug: string; // ámbito aceptado por el importador: "galicia", "andalucia"…
}

export interface Province {
  code: string; // "15"
  name: string;
  ccaa: string; // "ca12"
  extract: string; // "europe/spain/galicia/la_coruna"
}

export const CCAA: Ccaa[] = [
  { code: "ca01", name: "Andalucía", slug: "andalucia" },
  { code: "ca02", name: "Aragón", slug: "aragon" },
  { code: "ca03", name: "Principado de Asturias", slug: "asturias" },
  { code: "ca04", name: "Illes Balears", slug: "baleares" },
  { code: "ca05", name: "Canarias", slug: "canarias" },
  { code: "ca06", name: "Cantabria", slug: "cantabria" },
  { code: "ca07", name: "Castilla y León", slug: "castilla_y_leon" },
  { code: "ca08", name: "Castilla-La Mancha", slug: "castilla_la_mancha" },
  { code: "ca09", name: "Cataluña", slug: "cataluna" },
  { code: "ca10", name: "Comunitat Valenciana", slug: "valencia" },
  { code: "ca11", name: "Extremadura", slug: "extremadura" },
  { code: "ca12", name: "Galicia", slug: "galicia" },
  { code: "ca13", name: "Comunidad de Madrid", slug: "madrid" },
  { code: "ca14", name: "Región de Murcia", slug: "murcia" },
  { code: "ca15", name: "Comunidad Foral de Navarra", slug: "navarra" },
  { code: "ca16", name: "País Vasco", slug: "pais_vasco" },
  { code: "ca17", name: "La Rioja", slug: "la_rioja" },
  { code: "ca18", name: "Ceuta", slug: "ceuta" },
  { code: "ca19", name: "Melilla", slug: "melilla" },
];

const E = "europe/spain";
export const PROVINCES: Province[] = [
  { code: "01", name: "Araba/Álava", ccaa: "ca16", extract: `${E}/euskadi/alava` },
  { code: "02", name: "Albacete", ccaa: "ca08", extract: `${E}/castilla_la_mancha/albacete` },
  { code: "03", name: "Alicante/Alacant", ccaa: "ca10", extract: `${E}/comunitat_valenciana/alicante` },
  { code: "04", name: "Almería", ccaa: "ca01", extract: `${E}/andalucia/almeria` },
  { code: "05", name: "Ávila", ccaa: "ca07", extract: `${E}/castilla_y_leon/avila` },
  { code: "06", name: "Badajoz", ccaa: "ca11", extract: `${E}/extremadura/badajoz` },
  { code: "07", name: "Illes Balears", ccaa: "ca04", extract: `${E}/illes_balears` },
  { code: "08", name: "Barcelona", ccaa: "ca09", extract: `${E}/catalunya/barcelona` },
  { code: "09", name: "Burgos", ccaa: "ca07", extract: `${E}/castilla_y_leon/burgos` },
  { code: "10", name: "Cáceres", ccaa: "ca11", extract: `${E}/extremadura/caceres` },
  { code: "11", name: "Cádiz", ccaa: "ca01", extract: `${E}/andalucia/cadiz` },
  { code: "12", name: "Castellón/Castelló", ccaa: "ca10", extract: `${E}/comunitat_valenciana/castellon` },
  { code: "13", name: "Ciudad Real", ccaa: "ca08", extract: `${E}/castilla_la_mancha/ciudad_real` },
  { code: "14", name: "Córdoba", ccaa: "ca01", extract: `${E}/andalucia/cordoba` },
  { code: "15", name: "A Coruña", ccaa: "ca12", extract: `${E}/galicia/la_coruna` },
  { code: "16", name: "Cuenca", ccaa: "ca08", extract: `${E}/castilla_la_mancha/cuenca` },
  { code: "17", name: "Girona", ccaa: "ca09", extract: `${E}/catalunya/girona` },
  { code: "18", name: "Granada", ccaa: "ca01", extract: `${E}/andalucia/granada` },
  { code: "19", name: "Guadalajara", ccaa: "ca08", extract: `${E}/castilla_la_mancha/guadalajara` },
  { code: "20", name: "Gipuzkoa", ccaa: "ca16", extract: `${E}/euskadi/guipuzcoa` },
  { code: "21", name: "Huelva", ccaa: "ca01", extract: `${E}/andalucia/huelva` },
  { code: "22", name: "Huesca", ccaa: "ca02", extract: `${E}/aragon/huesca` },
  { code: "23", name: "Jaén", ccaa: "ca01", extract: `${E}/andalucia/jaen` },
  { code: "24", name: "León", ccaa: "ca07", extract: `${E}/castilla_y_leon/leon` },
  { code: "25", name: "Lleida", ccaa: "ca09", extract: `${E}/catalunya/lleida` },
  { code: "26", name: "La Rioja", ccaa: "ca17", extract: `${E}/la_rioja` },
  { code: "27", name: "Lugo", ccaa: "ca12", extract: `${E}/galicia/lugo` },
  { code: "28", name: "Madrid", ccaa: "ca13", extract: `${E}/comunidad_de_madrid` },
  { code: "29", name: "Málaga", ccaa: "ca01", extract: `${E}/andalucia/malaga` },
  { code: "30", name: "Murcia", ccaa: "ca14", extract: `${E}/region_de_murcia` },
  { code: "31", name: "Navarra", ccaa: "ca15", extract: `${E}/comunidad_foral_de_navarra` },
  { code: "32", name: "Ourense", ccaa: "ca12", extract: `${E}/galicia/ourense` },
  { code: "33", name: "Asturias", ccaa: "ca03", extract: `${E}/asturias` },
  { code: "34", name: "Palencia", ccaa: "ca07", extract: `${E}/castilla_y_leon/palencia` },
  { code: "35", name: "Las Palmas", ccaa: "ca05", extract: "africa/spain/canarias/las_palmas" },
  { code: "36", name: "Pontevedra", ccaa: "ca12", extract: `${E}/galicia/pontevedra` },
  { code: "37", name: "Salamanca", ccaa: "ca07", extract: `${E}/castilla_y_leon/salamanca` },
  { code: "38", name: "Santa Cruz de Tenerife", ccaa: "ca05", extract: "africa/spain/canarias/santa_cruz_de_tenerife" },
  { code: "39", name: "Cantabria", ccaa: "ca06", extract: `${E}/cantabria` },
  { code: "40", name: "Segovia", ccaa: "ca07", extract: `${E}/castilla_y_leon/segovia` },
  { code: "41", name: "Sevilla", ccaa: "ca01", extract: `${E}/andalucia/sevilla` },
  { code: "42", name: "Soria", ccaa: "ca07", extract: `${E}/castilla_y_leon/soria` },
  { code: "43", name: "Tarragona", ccaa: "ca09", extract: `${E}/catalunya/tarragona` },
  { code: "44", name: "Teruel", ccaa: "ca02", extract: `${E}/aragon/teruel` },
  { code: "45", name: "Toledo", ccaa: "ca08", extract: `${E}/castilla_la_mancha/toledo` },
  { code: "46", name: "Valencia/València", ccaa: "ca10", extract: `${E}/comunitat_valenciana/valencia` },
  { code: "47", name: "Valladolid", ccaa: "ca07", extract: `${E}/castilla_y_leon/valladolid` },
  { code: "48", name: "Bizkaia", ccaa: "ca16", extract: `${E}/euskadi/vizcaya` },
  { code: "49", name: "Zamora", ccaa: "ca07", extract: `${E}/castilla_y_leon/zamora` },
  { code: "50", name: "Zaragoza", ccaa: "ca02", extract: `${E}/aragon/zaragoza` },
  { code: "51", name: "Ceuta", ccaa: "ca18", extract: "africa/spain/ceuta" },
  { code: "52", name: "Melilla", ccaa: "ca19", extract: "africa/spain/melilla" },
];

/**
 * Traduce un ámbito escrito por una persona a códigos de provincia:
 * "espana" (todas), el slug de una comunidad ("galicia") o un código de provincia ("15").
 * Devuelve null si no es ninguno de esos (p. ej. un código de municipio).
 */
export function provincesForScope(scope: string): string[] | null {
  const s = scope.trim().toLowerCase();
  if (s === "espana" || s === "españa") return PROVINCES.map((p) => p.code);
  const ccaa = CCAA.find((c) => c.slug === s);
  if (ccaa) return PROVINCES.filter((p) => p.ccaa === ccaa.code).map((p) => p.code);
  if (/^\d{2}$/.test(s) && PROVINCES.some((p) => p.code === s)) return [s];
  return null;
}
