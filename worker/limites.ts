// De dónde salen los límites municipales.
//
// La importación real los lee de `admin_areas`, y si faltan los descarga de OSM y los
// inserta. Eso convierte cualquier previsualización de una provincia nueva en una escritura
// de miles de filas. Para separar las dos cosas, quién provee los límites se inyecta:
//
//   limitesDeBaseDeDatos  → comportamiento de siempre; lo usa la importación real.
//   limitesDelExtracto    → lee los límites del propio extracto de OSM; no escribe nunca.
//
// No son dos fuentes distintas: `admin_areas` se rellena justamente con lo que devuelve
// `extractMunicipalities()`. El proveedor de extracto lee lo mismo, antes de guardarlo.
//
// La contención la resuelve PostGIS en los dos casos, con la misma función `st_contains`,
// el mismo SRID y el mismo `st_makevalid`. Lo único que cambia es que el polígono llega
// como parámetro en lugar de leerse de una tabla: sigue siendo un SELECT. Escribir aquí un
// punto-en-polígono propio sería una segunda implementación de una regla ya existente.

import path from "node:path";
import type { Config } from "./config";
import type { Db } from "./db";
import { ensureExtract, extractMunicipalities, PROVINCE_EXTRACTS } from "./sources/osm";

export interface Municipio {
  code: string;
  name: string;
}

export interface ProveedorDeLimites {
  /** Municipios de una provincia (código INE de 2 dígitos). */
  municipios(provincia: string): Promise<Municipio[]>;
  /** Índices de `puntos` que caen dentro del municipio. */
  contiene(code: string, puntos: [number, number][]): Promise<number[]>;
  /** Para los mensajes: de dónde salen estos límites. */
  readonly origen: string;
}

/** SQL de contención a partir de un polígono recibido como parámetro. Solo lectura. */
const CONTIENE_GEOJSON = `
  select (t.i - 1)::int as i
    from unnest($1::float8[], $2::float8[]) with ordinality as t(lon, lat, i)
   where extensions.st_contains(
           extensions.st_makevalid(extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326)),
           extensions.st_setsrid(extensions.st_makepoint(t.lon, t.lat), 4326))`;

/** SQL de contención leyendo el polígono de admin_areas. Es el de la importación de siempre. */
const CONTIENE_ADMIN_AREAS = `
  select (t.i - 1)::int as i
    from unnest($1::float8[], $2::float8[]) with ordinality as t(lon, lat, i)
   where extensions.st_contains((select geom from public.admin_areas where code = $3),
                                extensions.st_setsrid(extensions.st_makepoint(t.lon, t.lat), 4326))`;

/**
 * Comportamiento de siempre: los límites salen de `admin_areas`. Si faltan, el llamante
 * debe haberlos cargado antes (`ensureMunicipality`). Este proveedor no carga nada por su
 * cuenta, para que quien escribe sea siempre el mismo sitio y se vea en el código.
 */
export function limitesDeBaseDeDatos(db: Db): ProveedorDeLimites {
  return {
    origen: "admin_areas",
    async municipios(provincia) {
      const { rows } = await db.query<Municipio>(
        `select code, name from public.admin_areas
          where level = 'municipio' and left(code, 2) = $1 and geom is not null
          order by code`,
        [provincia],
      );
      return rows;
    },
    async contiene(code, puntos) {
      const { rows } = await db.query<{ i: number }>(CONTIENE_ADMIN_AREAS, [
        puntos.map((p) => p[0]),
        puntos.map((p) => p[1]),
        code,
      ]);
      return rows.map((r) => r.i);
    },
  };
}

/**
 * Límites leídos del extracto provincial de OSM. No escribe nada: `extractMunicipalities()`
 * solo ejecuta osmium sobre un fichero local, y la contención es un SELECT con el polígono
 * como parámetro.
 *
 * Los polígonos se quedan en memoria durante la ejecución, así que previsualizar los 179
 * municipios de Madrid extrae los límites una sola vez.
 */
export function limitesDelExtracto(db: Db, config: Config): ProveedorDeLimites {
  const porProvincia = new Map<string, Promise<Map<string, Municipio & { geometry: unknown }>>>();

  const cargar = (provincia: string) => {
    let p = porProvincia.get(provincia);
    if (!p) {
      p = (async () => {
        if (!PROVINCE_EXTRACTS[provincia]) throw new Error(`Provincia ${provincia} fuera de la cobertura configurada`);
        const { file } = await ensureExtract(config, provincia);
        const munis = await extractMunicipalities(file, provincia, path.join(config.CACHE_DIR, "work", `admin-${provincia}`));
        return new Map(munis.map((m) => [m.code, m]));
      })();
      porProvincia.set(provincia, p);
    }
    return p;
  };

  return {
    origen: "extracto de OpenStreetMap (sin escribir en admin_areas)",
    async municipios(provincia) {
      const m = await cargar(provincia);
      return [...m.values()].map(({ code, name }) => ({ code, name })).sort((a, b) => (a.code < b.code ? -1 : 1));
    },
    async contiene(code, puntos) {
      const m = await cargar(code.slice(0, 2));
      const muni = m.get(code);
      if (!muni) throw new Error(`El municipio ${code} no aparece en los límites del extracto de OSM`);
      const { rows } = await db.query<{ i: number }>(CONTIENE_GEOJSON, [
        puntos.map((p) => p[0]),
        puntos.map((p) => p[1]),
        JSON.stringify(muni.geometry),
      ]);
      return rows.map((r) => r.i);
    },
  };
}
