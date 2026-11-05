// Registro de Entidades Deportivas de Canarias (datos.canarias.es, CC BY 4.0 según el aviso legal del portal).
// Dos ficheros: entidades y modalidades de cada entidad. Publica código de municipio (INE + dígito de control),
// pero no dirección ni contacto. El fichero publicado es una foto de diciembre de 2024.

import { parse } from "csv-parse/sync";
import { CYCLING, fetchDaily, isCyclingModality, requireColumns, type RegistryRow, type RegistrySource } from "./common";

const BASE = "https://datos.canarias.es/catalogos/general/dataset/0bbaa04b-4c96-4652-835d-3ffed1ae7a9b/resource";
const URLS = {
  entidades: `${BASE}/f479adac-6673-4601-a8ea-82b897330b0e/download/entidades_241209.csv`,
  modalidades: `${BASE}/b3ab78f9-0f7a-43d2-a630-178526230fa6/download/modalidades_241209.csv`,
};

const csv = (text: string) =>
  parse(text, { bom: true, columns: true, skip_empty_lines: true, relax_quotes: true, trim: true }) as Record<string, string>[];

export function parseCanarias(entidades: string, modalidades: string): RegistryRow[] {
  const ent = csv(entidades);
  const mod = csv(modalidades);
  requireColumns("registro_canarias", ent[0], ["CodEntidadDeportiva", "NumeroRedc", "Denominacion", "CodProvincia", "CodMunicipio", "Municipio", "Seccion"]);
  requireColumns("registro_canarias", mod[0], ["CodEntidadDeportiva", "Modalidad"]);
  const byEntity = new Map<string, string[]>();
  for (const m of mod) {
    const list = byEntity.get(m.CodEntidadDeportiva!) ?? [];
    list.push(m.Modalidad!);
    byEntity.set(m.CodEntidadDeportiva!, list);
  }
  return ent.map((r) => {
    const mods = byEntity.get(r.CodEntidadDeportiva!) ?? [];
    // CodMunicipio = código INE de 5 cifras + dígito de control.
    const ine = /^\d{6}$/.test(r.CodMunicipio ?? "") ? r.CodMunicipio!.slice(0, 5) : null;
    return {
      externalId: r.CodEntidadDeportiva!,
      name: r.Denominacion ?? "",
      kind: r.Seccion ?? "",
      nif: null,
      modalities: mods.some(isCyclingModality) ? [CYCLING, ...mods] : mods,
      address: null,
      postalCode: null,
      provinceCode: ine ? ine.slice(0, 2) : null,
      municipalityCode: ine,
      municipalityName: r.Municipio || null,
      phones: [],
      emails: [],
      web: null,
      location: null,
      raw: { ...r, modalidades: mods },
    };
  });
}

export const canarias: RegistrySource = {
  id: "registro_canarias",
  provinces: ["35", "38"],
  datasetUrl: "https://datos.canarias.es/catalogos/general/dataset/0bbaa04b-4c96-4652-835d-3ffed1ae7a9b",
  async load(config) {
    const e = await fetchDaily(config, this.id, "entidades.csv", URLS.entidades);
    const m = await fetchDaily(config, this.id, "modalidades.csv", URLS.modalidades);
    return { rows: parseCanarias(e.buf.toString("utf8"), m.buf.toString("utf8")), version: e.version };
  },
};
