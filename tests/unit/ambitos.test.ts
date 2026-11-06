// Ámbitos geográficos: qué selecciona cada código.
//
// Importa porque `npm run previsualizar -- osm madrid barcelona` NO hace lo que parece:
// «madrid» es una comunidad autónoma y «barcelona» es una provincia, que no es un ámbito
// reconocido. El comando correcto para Madrid y Barcelona es `osm 28 08`.
import { describe, expect, it } from "vitest";
import { PROVINCES, provincesForScope } from "../../src/lib/domain/territory";

const nombre = (code: string) => PROVINCES.find((p) => p.code === code)?.name;

describe("códigos de provincia", () => {
  it("28 es Madrid y 08 es Barcelona", () => {
    expect(nombre("28")).toBe("Madrid");
    expect(nombre("08")).toBe("Barcelona");
  });

  it("«osm 28 08» selecciona exactamente esas dos provincias", () => {
    expect(provincesForScope("28")).toEqual(["28"]);
    expect(provincesForScope("08")).toEqual(["08"]);
    const ambos = [...provincesForScope("28")!, ...provincesForScope("08")!];
    expect(ambos.map(nombre)).toEqual(["Madrid", "Barcelona"]);
  });

  it("cada provincia apunta a su extracto de OSM", () => {
    expect(PROVINCES.find((p) => p.code === "28")!.extract).toContain("comunidad_de_madrid");
    expect(PROVINCES.find((p) => p.code === "08")!.extract).toContain("barcelona");
  });
});

describe("ámbitos que se prestan a confusión", () => {
  it("«barcelona» NO es un ámbito válido: es una provincia, no una comunidad", () => {
    expect(provincesForScope("barcelona")).toBeNull();
  });

  it("«madrid» sí es válido, pero como comunidad autónoma (que aquí es una sola provincia)", () => {
    expect(provincesForScope("madrid")).toEqual(["28"]);
  });

  it("«cataluna» son las CUATRO provincias catalanas, no solo Barcelona", () => {
    const cat = provincesForScope("cataluna")!;
    expect(cat).toHaveLength(4);
    expect(cat).toContain("08");
    expect(cat.map(nombre).sort()).toEqual(["Barcelona", "Girona", "Lleida", "Tarragona"]);
  });

  it("un código de municipio no es un ámbito de provincia", () => {
    expect(provincesForScope("28079")).toBeNull();
  });

  it("«espana» son las 52 provincias", () => {
    expect(provincesForScope("espana")).toHaveLength(52);
    expect(provincesForScope("españa")).toHaveLength(52);
  });
});
