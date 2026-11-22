// Registro de Entidades Deportivas de Aragón (buscador público de SIGO, Dirección General de Deporte).
// El portal de datos abiertos de Aragón publica federaciones e instalaciones, pero no los clubes.
// El buscador público sí los da, filtrando por modalidad, y además trae dirección y correo.
// Guarda los criterios de búsqueda en la sesión: hay que abrir la página, enviar el formulario
// y luego pedir el listado completo con la misma cookie.

import type { Config } from "../../config";
import { userAgent } from "../../config";
import { fetchWithRetry } from "../../http";
import { CYCLING, isCyclingModality, type RegistryRow, type RegistrySource } from "./common";

const PROVINCES = ["22", "44", "50"];

const BASE = "https://aplicaciones.aragon.es/sigodgd/entidadesPublico";
/** Valor de «Modalidad» del buscador. Es la única modalidad ciclista del desplegable. */
const MODALITY_ID = "14";
const PAGE_SIZE = 1000;

const PROVINCE_BY_NAME: Record<string, string> = { huesca: "22", teruel: "44", zaragoza: "50" };

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Total de entidades que anuncia el buscador. */
export function parseTotal(html: string): number | null {
  const m = /id="totalElementos"\s+value="(\d+)"/.exec(html);
  return m ? Number(m[1]) : null;
}

/** Traduce la tabla del buscador. Columnas: nº registro, nombre, tipo, fecha, email, provincia, localidad, dirección, modalidades. */
export function parseAragon(html: string): RegistryRow[] {
  const rows: RegistryRow[] = [];
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map(text);
    if (cells.length < 9) continue;
    const [num, name, kind, , email, province, town, address, modalities] = cells as string[];
    if (!/^\d{1,8}\/\d{1,4}$/.test(num ?? "")) continue;
    if (!name) continue;
    const mods = (modalities ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const normalized = [...new Set(mods.map((m) => (isCyclingModality(m) ? CYCLING : m.toUpperCase())))];
    if (!normalized.includes(CYCLING)) continue;
    rows.push({
      externalId: num!,
      name: name!,
      kind: kind || "Club deportivo",
      nif: null,
      modalities: normalized,
      address: address || null,
      postalCode: null,
      provinceCode: PROVINCE_BY_NAME[(province ?? "").toLowerCase()] ?? null,
      municipalityCode: null,
      municipalityName: town || null,
      phones: [],
      emails: email ? [email] : [],
      web: null,
      location: null,
      raw: { numero: num, nombre: name, tipo: kind, email, provincia: province, localidad: town, direccion: address, modalidades: modalities },
    });
  }
  return rows;
}

function cookiesOf(res: Response, previous: string): string {
  const set = res.headers.getSetCookie?.() ?? [];
  const jar = new Map<string, string>();
  for (const part of previous.split("; ").filter(Boolean)) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const raw of set) {
    const [pair] = raw.split(";");
    const i = (pair ?? "").indexOf("=");
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

export const aragon: RegistrySource = {
  id: "registro_aragon",
  provinces: PROVINCES,
  datasetUrl: BASE,
  async load(config: Config) {
    const ua = userAgent(config);
    // 1) Abrir el buscador para obtener la sesión.
    const first = await fetchWithRetry(BASE, { userAgent: ua, timeoutMs: 120_000 });
    let cookie = cookiesOf(first, "");
    await first.text();
    // 2) Enviar el formulario: los criterios quedan guardados en la sesión.
    const search = await fetchWithRetry(BASE, {
      userAgent: ua,
      timeoutMs: 180_000,
      method: "POST",
      body: `numRegistro=&seccion=&nombre=&domicilio=&idProvincia=&idLocalidad=&idModalidad=${MODALITY_ID}&idTipoEntidad=`,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    });
    cookie = cookiesOf(search, cookie);
    const total = parseTotal(await search.text());
    if (total === null) throw new Error(`${this.id}: el buscador no indica el total de entidades; posible cambio de formato`);
    if (total === 0) throw new Error(`${this.id}: el buscador no ha devuelto ninguna entidad de ciclismo`);
    // 3) Pedir todas las fichas en una página.
    const listing = await fetchWithRetry(`${BASE}?page=0&size=${PAGE_SIZE}`, {
      userAgent: ua,
      timeoutMs: 180_000,
      headers: { Cookie: cookie },
    });
    const html = await listing.text();
    const rows = parseAragon(html);
    if (rows.length === 0) throw new Error(`${this.id}: el listado no trae fichas con la tabla esperada`);
    // Si el buscador pagina de otra forma, mejor fallar que importar la mitad del registro.
    if (rows.length < total * 0.9) {
      throw new Error(`${this.id}: solo se han leído ${rows.length} de ${total} entidades`);
    }
    return { rows, version: `${new Date().toISOString().slice(0, 10)}#${total}` };
  },
};
