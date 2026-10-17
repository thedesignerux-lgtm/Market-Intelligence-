import { describe, expect, it } from "vitest";
import {
  addressLooksPersonal,
  displayName,
  normalizeName,
  normalizeNif,
  normalizePhone,
  normalizePostalCode,
  normalizeWebsite,
  searchNormalize,
} from "../../src/lib/domain/normalize";
import { nameSimilarity, scoreMatch, type MatchCandidate } from "../../src/lib/domain/matching";
import { matchCategories, requiredOsmFilters, type CategoryMapping } from "../../src/lib/domain/categories";

describe("normalización", () => {
  it("quita acentos y signos", () => {
    expect(searchNormalize("  Rúa do Hórreo, 54 ")).toBe("rua do horreo 54");
    expect(searchNormalize("A Coruña")).toBe("a coruna");
  });

  it("elimina formas jurídicas y palabras vacías del nombre", () => {
    expect(normalizeName("C. CICLISTA COMPOSTELANO")).toBe("ciclista compostelano");
    expect(normalizeName("Bicicletas Oliveira, S.L.")).toBe("bicicletas oliveira");
    expect(normalizeName("Club Deportivo")).toBe("club deportivo");
  });

  it("convierte mayúsculas a un nombre legible", () => {
    expect(displayName("CLUB CICLISTA SAN LÁZARO")).toBe("Club Ciclista San Lázaro");
    expect(displayName("CLUB BTT ULTREIA")).toBe("Club BTT Ultreia");
    expect(displayName("Bici Toupas")).toBe("Bici Toupas");
  });

  it("normaliza teléfonos españoles", () => {
    expect(normalizePhone("981 14 14 33")).toEqual({ e164: "+34981141433", isMobile: false });
    expect(normalizePhone("671989195")?.isMobile).toBe(true);
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("reduce webs a dominio", () => {
    expect(normalizeWebsite("https://www.Ejemplo.es/contacto")).toBe("ejemplo.es");
    expect(normalizeWebsite("ejemplo.gal")).toBe("ejemplo.gal");
    expect(normalizeWebsite("https://www.facebook.com/ClubX/")).toBe("facebook.com/clubx");
    expect(normalizeWebsite("no es una web")).toBeNull();
    expect(normalizeWebsite("javascript:alert(1)")).toBeNull();
  });

  it("valida códigos postales y NIF", () => {
    expect(normalizePostalCode("15701")).toBe("15701");
    expect(normalizePostalCode("8001")).toBe("08001");
    expect(normalizePostalCode("99999")).toBeNull();
    expect(normalizeNif("g-15110026")).toBe("G15110026");
    expect(normalizeNif("xx")).toBeNull();
  });

  it("detecta direcciones que parecen domicilios particulares", () => {
    expect(addressLooksPersonal("BERLÍN, 11, 1ºD")).toBe(true);
    expect(addressLooksPersonal("RUA MONTEFARO 1 6IZQ")).toBe(true);
    expect(addressLooksPersonal("Rúa do Vilar 33, 4º")).toBe(true);
    expect(addressLooksPersonal("RUA Hórreo 54")).toBe(false);
    expect(addressLooksPersonal("Estadio Multiusos San Lázaro")).toBe(false);
    expect(addressLooksPersonal("RUA XESÚS CARRO 3 1derec")).toBe(true);
    expect(addressLooksPersonal("RÚA RESTOLLAL, 35, BAIXO")).toBe(false);
    expect(addressLooksPersonal("RÚA PONTE DO SAR, 43 C, 1 E")).toBe(true);
  });
});

describe("similitud y deduplicación", () => {
  const base: MatchCandidate = {
    normalizedName: "ciclista compostelano",
    entityType: "club",
    location: [-8.5448, 42.8782],
    locationPrecise: true,
    municipalityCode: "15078",
    phones: [],
    domains: [],
    nifs: [],
  };

  it("nombres equivalentes puntúan alto", () => {
    expect(nameSimilarity("ciclista compostelano", "compostelano")).toBeGreaterThan(0.5);
    expect(nameSimilarity("bici toupas", "toupas")).toBeGreaterThan(0.5);
    expect(nameSimilarity("ciclista compostelano", "ciclista san lazaro")).toBeLessThan(0.4);
  });

  it("mismo NIF → misma entidad; NIF distinto → distintas", () => {
    expect(scoreMatch({ ...base, nifs: ["G1"] }, { ...base, nifs: ["G1"] }).decision).toBe("same");
    expect(scoreMatch({ ...base, nifs: ["G1"] }, { ...base, nifs: ["G2"] }).decision).toBe("different");
  });

  it("nombre parecido + cerca + mismo teléfono → misma entidad", () => {
    const r = scoreMatch(base, { ...base, normalizedName: "compostelano", location: [-8.5449, 42.8783], phones: ["+34981000000"] });
    // Sin teléfono compartido en ambos lados no hay señal de contacto; añadimos al primero:
    const r2 = scoreMatch({ ...base, phones: ["+34981000000"] }, { ...base, normalizedName: "compostelano", location: [-8.5449, 42.8783], phones: ["+34981000000"] });
    expect(r.decision).not.toBe("different");
    expect(r2.decision).toBe("same");
  });

  it("solo nombre parecido, sin ubicación ni contacto → revisión manual, nunca fusión automática", () => {
    const r = scoreMatch({ ...base, location: null }, { ...base, location: null });
    expect(r.decision).toBe("review");
  });

  it("tipos distintos nunca coinciden", () => {
    expect(scoreMatch(base, { ...base, entityType: "comercio" }).decision).toBe("different");
  });

  it("lejos y con nombre distinto → diferentes", () => {
    const r = scoreMatch(base, { ...base, normalizedName: "rutas celtas", location: [-8.4, 42.9] });
    expect(r.decision).toBe("different");
  });
});

describe("categorías", () => {
  const mappings: CategoryMapping[] = [
    { sourceId: "osm", match: { shop: "bicycle" }, categoryId: "comercio.deporte.ciclismo", entityType: "comercio", priority: 200 },
    { sourceId: "osm", match: { shop: "sports", sport: "cycling" }, categoryId: "comercio.deporte.ciclismo", entityType: "comercio", priority: 190 },
    { sourceId: "osm", match: { "service:bicycle:repair": "yes" }, categoryId: "servicio.ciclismo.taller", entityType: "comercio", priority: 140 },
    { sourceId: "red_galicia", match: { modalidad: "CICLISMO" }, categoryId: "club.deportivo.ciclismo", entityType: "club", priority: 200 },
  ];

  it("asigna categorías por etiquetas y ordena por prioridad", () => {
    const r = matchCategories("osm", { shop: "bicycle", "service:bicycle:repair": "yes" }, mappings);
    expect(r.map((x) => x.categoryId)).toEqual(["comercio.deporte.ciclismo", "servicio.ciclismo.taller"]);
  });

  it("exige todos los pares de la regla", () => {
    expect(matchCategories("osm", { shop: "sports" }, mappings)).toEqual([]);
    expect(matchCategories("osm", { shop: "sports", sport: "running;cycling" }, mappings)).toHaveLength(1);
  });

  it("acepta varios valores por atributo", () => {
    expect(matchCategories("red_galicia", { modalidad: ["FÚTBOL", "CICLISMO"] }, mappings)).toHaveLength(1);
    expect(matchCategories("red_galicia", { modalidad: ["MOTOCICLISMO"] }, mappings)).toHaveLength(0);
  });

  it("genera filtros de osmium", () => {
    expect(requiredOsmFilters(mappings)).toEqual(["nwr/service:bicycle:repair=yes", "nwr/shop=bicycle", "nwr/shop=sports"]);
  });
});

import { buildQueries, requestedNumber, sameStreet, streetName } from "../../worker/geocode";

describe("geocodificación: construcción de consultas", () => {
  it("limpia el nombre de la calle", () => {
    expect(streetName("RUA RÚA DO LIMPADOIRO S/N")).toBe("rua do limpadoiro");
    expect(streetName("RUA XESÚS CARRO 3 1derec")).toBe("rua xesus carro");
    expect(streetName("BERLÍN, 11, 1ºD")).toBe("berlin");
  });

  it("toma el número de portal y no el piso", () => {
    expect(requestedNumber("RÚA PONTE DO SAR, 43 C, 1 E")).toBe(43);
    expect(requestedNumber("BERLÍN, 11, 1ºD")).toBe(11);
    expect(requestedNumber("RÚA DO LIMPADOIRO S/N")).toBeNull();
  });

  it("en domicilios particulares solo consulta la calle", () => {
    const q = buildQueries({ address: "BERLÍN, 11, 1ºD", postalCode: null, municipalityName: "Santiago de Compostela", municipalityCode: "15078", streetOnly: true });
    expect(q).toEqual([{ q: "berlin, Santiago de Compostela", streetOnly: true }]);
  });

  it("prueba primero con número y después solo la calle", () => {
    const q = buildQueries({ address: "RUA Hórreo 54", postalCode: "15701", municipalityName: "Santiago de Compostela", municipalityCode: "15078", streetOnly: false });
    expect(q.map((x) => x.q)).toEqual(["rua horreo 54, Santiago de Compostela", "rua horreo, Santiago de Compostela"]);
  });

  it("solo acepta la misma calle", () => {
    expect(sameStreet("RÚA DO VILAR 33", "VILAR (DO)")).toBe(true);
    expect(sameStreet("RÚA DO VILAR 33", "Vilar Do Rei")).toBe(false);
    expect(sameStreet("RÚA ÁNXEL CASAL 3", "ANXIL")).toBe(false);
    expect(sameStreet("RUA Hórreo 54", "HORREO")).toBe(true);
  });
});
