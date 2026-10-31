// Registro de Entidades Deportivas del País Vasco (Open Data Euskadi, CC BY 4.0, actualización semanal).
// Publica código de municipio y coordenadas, pero solo la modalidad principal de cada club.

import { CYCLING, fetchDaily, isCyclingModality, type RegistryRow, type RegistrySource } from "./common";

const URL = "https://opendata.euskadi.eus/contenidos/ds_localizaciones/entidades_deportivas/opendata/clubes.geojson";

interface Feature {
  properties: Record<string, string | null>;
  geometry: { type: string; coordinates: [number, number] } | null;
}

export function parseEuskadi(text: string): RegistryRow[] {
  const data = JSON.parse(text) as { features?: Feature[] };
  if (!Array.isArray(data.features) || data.features.length === 0) throw new Error("registro_euskadi: el GeoJSON no tiene elementos");
  const first = data.features[0]!.properties;
  for (const c of ["idregistro", "nombre", "modalidadprincipal", "codigoprovincia", "codigomunicipio"]) {
    if (!(c in first)) throw new Error(`registro_euskadi: la fuente ha cambiado de formato; falta ${c}`);
  }
  return data.features.map((f) => {
    const p = f.properties;
    const mod = p.modalidadprincipal ?? "";
    const prov = (p.codigoprovincia ?? "").padStart(2, "0");
    const muni = (p.codigomunicipio ?? "").padStart(3, "0");
    const [lon, lat] = f.geometry?.type === "Point" ? f.geometry.coordinates : [NaN, NaN];
    const validPoint = Number.isFinite(lon) && Number.isFinite(lat) && lat > 42 && lat < 44 && lon > -4 && lon < -1;
    const cp = p.codigopostal && /^\d{5}$/.test(p.codigopostal.padStart(5, "0")) && p.codigopostal !== "0" ? p.codigopostal.padStart(5, "0") : null;
    return {
      externalId: p.idregistro ?? "",
      name: p.nombre ?? "",
      kind: p.tipo ?? "",
      nif: null,
      modalities: isCyclingModality(mod) ? [CYCLING, mod] : [mod],
      address: p.direccion || null,
      postalCode: cp,
      provinceCode: /^\d{2}$/.test(prov) ? prov : null,
      municipalityCode: /^\d{2}$/.test(prov) && /^\d{3}$/.test(muni) ? `${prov}${muni}` : null,
      municipalityName: p.municipio || null,
      phones: [],
      emails: [],
      web: null,
      location: validPoint ? { lon, lat } : null,
      raw: { ...p, geometry: f.geometry },
    };
  });
}

export const euskadi: RegistrySource = {
  id: "registro_euskadi",
  provinces: ["01", "20", "48"],
  datasetUrl: URL,
  async load(config) {
    const { buf, version } = await fetchDaily(config, this.id, "clubes.geojson", URL);
    return { rows: parseEuskadi(buf.toString("utf8")), version };
  },
};
