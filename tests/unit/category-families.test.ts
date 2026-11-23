import { describe, expect, it } from "vitest";
import {
  collapseCategories,
  familyOf,
  groupByFamily,
  parseCategories,
  serializeCategories,
  type Category,
} from "../../src/lib/domain/category-families";

// Las categorías reales del proyecto, con su relación madre/hija.
const CATEGORIES: Category[] = [
  { id: "comercio.deporte", name: "Tienda de deporte", parent_id: null },
  { id: "comercio.deporte.ciclismo", name: "Tienda de bicicletas", parent_id: "comercio.deporte" },
  { id: "servicio.ciclismo.taller", name: "Taller de bicicletas", parent_id: null },
  { id: "club.deportivo", name: "Club deportivo", parent_id: null },
  { id: "club.deportivo.ciclismo", name: "Club ciclista", parent_id: "club.deportivo" },
  { id: "asociacion.federacion", name: "Federación deportiva", parent_id: null },
  { id: "comunidad", name: "Comunidad online", parent_id: null },
  { id: "comunidad.ciclismo", name: "Comunidad ciclista", parent_id: "comunidad" },
  { id: "distribuidor.ciclismo", name: "Distribuidor de bicicletas", parent_id: null },
];

describe("familias de categorías", () => {
  it("reparte por el prefijo del identificador", () => {
    expect(familyOf("comercio.deporte.ciclismo")).toBe("comercio");
    expect(familyOf("distribuidor.ciclismo")).toBe("comercio");
    expect(familyOf("servicio.ciclismo.taller")).toBe("servicios");
    expect(familyOf("club.deportivo")).toBe("organizaciones");
    expect(familyOf("asociacion.federacion")).toBe("organizaciones");
    expect(familyOf("comunidad.ciclismo")).toBe("comunidades");
  });

  it("una categoría con prefijo desconocido no desaparece: cae en Otras", () => {
    expect(familyOf("formacion.escuela")).toBe("otras");
    const grupos = groupByFamily([...CATEGORIES, { id: "formacion.escuela", name: "Escuela", parent_id: null }]);
    expect(grupos.at(-1)).toMatchObject({ id: "otras" });
    expect(grupos.at(-1)!.categories.map((c) => c.id)).toEqual(["formacion.escuela"]);
  });

  it("agrupa en las cuatro familias y pone cada hija tras su madre", () => {
    const grupos = groupByFamily(CATEGORIES);
    expect(grupos.map((g) => g.name)).toEqual([
      "Comercios y distribuidores",
      "Servicios",
      "Organizaciones deportivas",
      "Comunidades",
    ]);
    expect(grupos[0]!.categories.map((c) => c.id)).toEqual([
      "comercio.deporte",
      "comercio.deporte.ciclismo",
      "distribuidor.ciclismo",
    ]);
    expect(grupos[2]!.categories.map((c) => c.id)).toEqual([
      "club.deportivo",
      "club.deportivo.ciclismo",
      "asociacion.federacion",
    ]);
  });

  it("no inventa ni duplica categorías", () => {
    const grupos = groupByFamily(CATEGORIES);
    const ids = grupos.flatMap((g) => g.categories.map((c) => c.id));
    expect(ids).toHaveLength(CATEGORIES.length);
    expect(new Set(ids).size).toBe(CATEGORIES.length);
  });

  it("no devuelve familias vacías", () => {
    const grupos = groupByFamily([{ id: "comunidad", name: "Comunidad online", parent_id: null }]);
    expect(grupos.map((g) => g.id)).toEqual(["comunidades"]);
  });
});

describe("valor del filtro", () => {
  it("lee varias categorías e ignora las que no existen", () => {
    expect(parseCategories("club.deportivo,inventada,comunidad", CATEGORIES)).toEqual([
      "club.deportivo",
      "comunidad",
    ]);
    expect(parseCategories(undefined, CATEGORIES)).toEqual([]);
    expect(parseCategories("club.deportivo,club.deportivo", CATEGORIES)).toEqual(["club.deportivo"]);
  });

  it("quita la hija cuando su madre también está marcada", () => {
    expect(collapseCategories(["club.deportivo", "club.deportivo.ciclismo"], CATEGORIES)).toEqual(["club.deportivo"]);
    // Sin la madre, la hija se queda.
    expect(collapseCategories(["club.deportivo.ciclismo"], CATEGORIES)).toEqual(["club.deportivo.ciclismo"]);
    // Una categoría con un identificador que empieza igual pero no es su hija no se toca.
    expect(collapseCategories(["servicio.ciclismo.taller", "comercio.deporte"], CATEGORIES)).toEqual([
      "servicio.ciclismo.taller",
      "comercio.deporte",
    ]);
  });

  it("escribe en orden estable y vacío cuando no hay nada", () => {
    expect(serializeCategories(["comunidad", "club.deportivo"])).toBe("club.deportivo,comunidad");
    expect(serializeCategories([])).toBeUndefined();
  });
});
