// Registro de Entidades Deportivas y Federaciones de Navarra (Gobierno de Navarra, CC BY 4.0).
// Tres ficheros: el registro, las actividades reconocidas de cada entidad y el catálogo de actividades.
// Publica la localidad por nombre (sin código INE): se resuelve después contra los municipios de la base.

import { parse } from "csv-parse/sync";
import { CYCLING, fetchDaily, isCyclingModality, requireColumns, type RegistryRow, type RegistrySource } from "./common";

const BASE = "https://datosabiertos.navarra.es/dataset";
const URLS = {
  registro: `${BASE}/9bb4acb3-06ff-46fc-87e1-ad69e8458652/resource/fbb69b7e-8a24-4322-8b42-096029a26905/download/pn_indj_registros.csv`,
  actividades: `${BASE}/0892c611-de98-4323-b20e-1d48bfdbab07/resource/da58af70-40c0-4539-b7a9-7964eb6d6636/download/downloadfile.aspxcodigocompletoopendatadeportivospn_indj_areconocidas.csv`,
  catalogo: `${BASE}/70177f58-3bef-40c8-a92e-2f1efab625f8/resource/95b3b46d-6294-458a-b6d1-3acbe88e233f/download/pn_indj_actividades.csv`,
  tipos: `${BASE}/47ea9dc5-81d6-4944-aebd-2fb7aaf50ba2/resource/da2a69aa-1627-414a-a798-a644e013bd68/download/pn_indj_tipos.csv`,
};

const csv = (text: string) =>
  parse(text, { delimiter: ";", bom: true, columns: true, skip_empty_lines: true, relax_quotes: true, trim: true }) as Record<string, string>[];

export function parseNavarra(registro: string, actividades: string, catalogo: string, tipos: string): RegistryRow[] {
  const reg = csv(registro);
  const act = csv(actividades);
  const cat = csv(catalogo);
  const tip = csv(tipos);
  requireColumns("registro_navarra", reg[0], ["ID_Registro", "Nombre", "NIF", "ID_Tipo_R", "Registro", "Direccion", "CP", "Localidad", "Web"]);
  requireColumns("registro_navarra", act[0], ["ID_Registro_R", "ID_Actividad_R"]);
  requireColumns("registro_navarra", cat[0], ["ID_Actividad", "Actividad"]);
  requireColumns("registro_navarra", tip[0], ["ID_Tipo", "Tipo"]);

  const activityName = new Map(cat.map((r) => [r.ID_Actividad!, r.Actividad!]));
  const typeName = new Map(tip.map((r) => [r.ID_Tipo!, r.Descripcion || r.Tipo!]));
  const byEntity = new Map<string, string[]>();
  for (const a of act) {
    const list = byEntity.get(a.ID_Registro_R!) ?? [];
    list.push(activityName.get(a.ID_Actividad_R!) ?? a.ID_Actividad_R!);
    byEntity.set(a.ID_Registro_R!, list);
  }

  return reg.map((r) => {
    const mods = byEntity.get(r.ID_Registro!) ?? [];
    return {
      externalId: r.ID_Registro!,
      name: r.Nombre ?? "",
      kind: typeName.get(r.ID_Tipo_R!) ?? "",
      nif: r.NIF || null,
      modalities: mods.some(isCyclingModality) ? [CYCLING, ...mods] : mods,
      address: r.Direccion || null,
      postalCode: r.CP || null,
      provinceCode: "31",
      municipalityCode: null,
      municipalityName: r.Localidad || null,
      phones: [],
      emails: [],
      web: r.Web || null,
      location: null,
      raw: { ...r, actividades: mods },
    };
  });
}

export const navarra: RegistrySource = {
  id: "registro_navarra",
  provinces: ["31"],
  datasetUrl: `${BASE}/9bb4acb3-06ff-46fc-87e1-ad69e8458652`,
  async load(config) {
    const files = await Promise.all(
      (Object.entries(URLS) as [keyof typeof URLS, string][]).map(async ([k, url]) => [k, await fetchDaily(config, this.id, `${k}.csv`, url)] as const),
    );
    const f = Object.fromEntries(files) as Record<keyof typeof URLS, { buf: Buffer; version: string }>;
    // Los ficheros de Navarra están en Latin-1.
    const dec = (b: Buffer) => new TextDecoder("latin1").decode(b);
    return {
      rows: parseNavarra(dec(f.registro.buf), dec(f.actividades.buf), dec(f.catalogo.buf), dec(f.tipos.buf)),
      version: f.registro.version,
    };
  },
};
