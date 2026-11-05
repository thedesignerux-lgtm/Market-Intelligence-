// Los dos proveedores de límites deben coincidir contra PostGIS real.
//
// Solo lectura: no inserta, no borra y no abre transacción de escritura. Se omite si no hay
// TEST_DATABASE_URL. Comprueba que resolver la contención con el polígono como parámetro da
// el mismo resultado que leerlo de admin_areas, que es la premisa de toda la previsualización.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { limitesDeBaseDeDatos } from "../../worker/limites";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let pool: pg.Pool;
beforeAll(() => {
  if (url) pool = new pg.Pool({ connectionString: url, max: 2 });
});
afterAll(async () => {
  if (pool) await pool.end();
});

d("proveedores de límites contra PostGIS real", () => {
  it("el polígono como parámetro da el mismo resultado que leerlo de admin_areas", async () => {
    // Un municipio cualquiera que ya tenga límites cargados.
    const { rows: munis } = await pool.query<{ code: string }>(
      `select code from public.admin_areas where level = 'municipio' and geom is not null order by code limit 1`,
    );
    if (munis.length === 0) return; // Base sin límites cargados: nada que comparar.
    const code = munis[0]!.code;

    // Puntos reales: entidades de ese municipio, más uno claramente fuera.
    const { rows: pts } = await pool.query<{ lon: number; lat: number }>(
      `select extensions.st_x(geom) as lon, extensions.st_y(geom) as lat
         from public.entities where municipality_code = $1 and geom is not null limit 20`,
      [code],
    );
    const puntos: [number, number][] = [...pts.map((p) => [p.lon, p.lat] as [number, number]), [0, 0]];

    const desdeTabla = await limitesDeBaseDeDatos(pool).contiene(code, puntos);

    // El mismo SQL que usa limitesDelExtracto, con la geometría de la tabla como parámetro.
    const { rows: geo } = await pool.query<{ g: string }>(
      `select extensions.st_asgeojson(geom) as g from public.admin_areas where code = $1`,
      [code],
    );
    const { rows: desdeParametro } = await pool.query<{ i: number }>(
      `select (t.i - 1)::int as i
         from unnest($1::float8[], $2::float8[]) with ordinality as t(lon, lat, i)
        where extensions.st_contains(
                extensions.st_makevalid(extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326)),
                extensions.st_setsrid(extensions.st_makepoint(t.lon, t.lat), 4326))`,
      [puntos.map((p) => p[0]), puntos.map((p) => p[1]), geo[0]!.g],
    );

    expect(desdeParametro.map((r) => r.i)).toEqual(desdeTabla);
    // El punto de control (0,0) nunca cae dentro de un municipio español.
    expect(desdeTabla).not.toContain(puntos.length - 1);
  });
});
