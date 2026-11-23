import { describe, expect, it } from "vitest";
import {
  ccaaCoverage,
  coveredByAncestor,
  levelOf,
  municipalityCoverage,
  parseTerritory,
  provinceCoverage,
  removePick,
  serializeTerritory,
  territoryPath,
  territoryQuery,
  toggleCcaa,
  toggleMunicipality,
  toggleProvince,
} from "../../src/lib/domain/territory-selection";

// ca12 Galicia (15 A Coruña, 27 Lugo, 32 Ourense, 36 Pontevedra) · ca13 Madrid (28)
// 15005 Arteixo · 28079 Madrid · 36057 Vigo

describe("códigos territoriales", () => {
  it("reconoce el nivel por la forma del código", () => {
    expect(levelOf("ca12")).toBe("ccaa");
    expect(levelOf("36")).toBe("provincia");
    expect(levelOf("36057")).toBe("municipio");
    expect(levelOf("ca99")).toBeNull();
    expect(levelOf("99")).toBeNull();
    expect(levelOf("espana")).toBeNull();
  });

  it("da la ruta geográfica para que un municipio no sea ambiguo", () => {
    expect(territoryPath("15005")).toEqual(["Galicia", "A Coruña"]);
    expect(territoryPath("15")).toEqual(["Galicia"]);
    expect(territoryPath("ca12")).toEqual([]);
  });
});

describe("lectura y escritura de la URL", () => {
  it("lee comunidades, provincias, municipios y exclusiones", () => {
    const picks = parseTerritory("ca12,28,-28079");
    expect(picks).toEqual([
      { code: "ca12", level: "ccaa", excluded: false },
      { code: "28", level: "provincia", excluded: false },
      { code: "28079", level: "municipio", excluded: true },
    ]);
  });

  it("ignora lo que no reconoce y no admite excluir provincias", () => {
    expect(parseTerritory("ca12,basura,-28,99999")).toEqual([{ code: "ca12", level: "ccaa", excluded: false }]);
  });

  it("acepta los parámetros antiguos y no duplica", () => {
    expect(serializeTerritory(parseTerritory(["15", "15"]))).toBe("15");
  });

  it("escribe en orden estable", () => {
    expect(serializeTerritory(parseTerritory("28079,-15005,ca12".split(",").join(",")))).toBe("ca12,28079,-15005");
    expect(serializeTerritory([])).toBeUndefined();
  });
});

describe("traducción a la consulta", () => {
  it("convierte una comunidad en sus provincias", () => {
    expect(territoryQuery(parseTerritory("ca12"))).toEqual({
      provinces: ["15", "27", "32", "36"],
      municipalities: [],
      excluded: [],
    });
  });

  it("omite un municipio que ya entra por su provincia", () => {
    expect(territoryQuery(parseTerritory("36,36057"))).toEqual({
      provinces: ["36"],
      municipalities: [],
      excluded: [],
    });
  });

  it("mantiene los municipios sueltos de provincias no seleccionadas", () => {
    const q = territoryQuery(parseTerritory("ca12,28079"));
    expect(q.provinces).toEqual(["15", "27", "32", "36"]);
    expect(q.municipalities).toEqual(["28079"]);
  });

  it("solo aplica una exclusión si su provincia está seleccionada", () => {
    expect(territoryQuery(parseTerritory("ca12,-15005")).excluded).toEqual(["15005"]);
    expect(territoryQuery(parseTerritory("28,-15005")).excluded).toEqual([]);
  });

  it("sin selección no filtra nada", () => {
    expect(territoryQuery([])).toEqual({ provinces: [], municipalities: [], excluded: [] });
  });
});

describe("estados de selección", () => {
  it("una comunidad seleccionada cubre sus provincias y municipios", () => {
    const picks = parseTerritory("ca12");
    expect(ccaaCoverage(picks, "ca12")).toBe("full");
    expect(provinceCoverage(picks, "36")).toBe("full");
    expect(municipalityCoverage(picks, "36057")).toBe("full");
    expect(coveredByAncestor(picks, "36057")).toBe(true);
    expect(ccaaCoverage(picks, "ca13")).toBe("none");
  });

  it("una provincia suelta deja la comunidad en parcial", () => {
    const picks = parseTerritory("36");
    expect(ccaaCoverage(picks, "ca12")).toBe("partial");
    expect(provinceCoverage(picks, "36")).toBe("full");
    expect(provinceCoverage(picks, "15")).toBe("none");
  });

  it("una exclusión deja en parcial a la provincia y a la comunidad", () => {
    const picks = parseTerritory("ca12,-36057");
    expect(ccaaCoverage(picks, "ca12")).toBe("partial");
    expect(provinceCoverage(picks, "36")).toBe("partial");
    expect(municipalityCoverage(picks, "36057")).toBe("none");
    expect(municipalityCoverage(picks, "36038")).toBe("full");
  });

  it("todas las provincias marcadas a mano equivalen a la comunidad completa", () => {
    expect(ccaaCoverage(parseTerritory("15,27,32,36"), "ca12")).toBe("full");
  });
});

describe("marcar y desmarcar", () => {
  it("pulsar una comunidad a medias la selecciona entera", () => {
    const picks = toggleCcaa(parseTerritory("36,15005,-27001"), "ca12");
    expect(serializeTerritory(picks)).toBe("ca12");
    expect(ccaaCoverage(picks, "ca12")).toBe("full");
  });

  it("pulsar una provincia con exclusiones la vuelve a dejar entera", () => {
    const picks = toggleProvince(parseTerritory("ca12,-36057"), "36");
    expect(serializeTerritory(picks)).toBe("ca12");
    expect(provinceCoverage(picks, "36")).toBe("full");
  });

  it("desmarcar una comunidad la deja vacía", () => {
    expect(toggleCcaa(parseTerritory("ca12"), "ca12")).toEqual([]);
  });

  it("quitar una provincia de una comunidad completa deja las demás", () => {
    const picks = toggleProvince(parseTerritory("ca12"), "36");
    expect(serializeTerritory(picks)).toBe("15,27,32");
    expect(ccaaCoverage(picks, "ca12")).toBe("partial");
    expect(provinceCoverage(picks, "36")).toBe("none");
  });

  it("desmarcar un municipio de una provincia seleccionada lo excluye", () => {
    const picks = toggleMunicipality(parseTerritory("36"), "36057");
    expect(serializeTerritory(picks)).toBe("36,-36057");
    expect(municipalityCoverage(picks, "36057")).toBe("none");
    // Volver a marcarlo quita la exclusión en lugar de añadirlo dos veces.
    expect(serializeTerritory(toggleMunicipality(picks, "36057"))).toBe("36");
  });

  it("un municipio fuera de toda selección se añade suelto", () => {
    const picks = toggleMunicipality([], "28079");
    expect(serializeTerritory(picks)).toBe("28079");
    expect(serializeTerritory(toggleMunicipality(picks, "28079"))).toBeUndefined();
  });

  it("la × de un chip quita solo ese territorio", () => {
    const picks = parseTerritory("ca12,28,28079");
    expect(serializeTerritory(removePick(picks, "ca12"))).toBe("28,28079");
    expect(serializeTerritory(removePick(parseTerritory("ca12,-36057"), "36057"))).toBe("ca12");
  });
});
