// Traducción del fichero de investigación a registros normalizados.
// Lo que se vigila aquí es que no se invente nada y que cada dato conserve su procedencia.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { empresaARegistro } from "../../worker/sources/curados";

const empresa = (campos: Record<string, unknown>, nombre = "Bike Difusion") => ({
  clave: "bikedifusion.com",
  nombre,
  campos: campos as never,
  fuentes: ["https://www.bikedifusion.com/"],
});

describe("empresa curada → registro normalizado", () => {
  it("usa el dominio como clave externa, para que dos fuentes no creen dos entidades", () => {
    const r = empresaARegistro(empresa({ web: { valor: "https://bikedifusion.com", fuente: "x", metodo: "verified", observado: "2026-11-05" } }))!;
    expect(r.externalId).toBe("bikedifusion.com");
    expect(r.entityType).toBe("distribuidor");
  });

  it("conserva método, fuente y fecha de cada campo propio", () => {
    const r = empresaARegistro(
      empresa({
        especializacion: { valor: "Componentes", fuente: "https://www.bikedifusion.com/", metodo: "verified", observado: "2026-11-05" },
        afiliacion: { valor: "Asociada a AMBE", fuente: "https://asociacionambe.com/asociados/", metodo: "found", observado: "2026-11-05" },
      }),
    )!;
    const esp = r.extraFields!.find((f) => f.field === "especializacion")!;
    const afi = r.extraFields!.find((f) => f.field === "afiliacion")!;

    expect(esp.method).toBe("verified");
    expect(esp.observedAt).toBe("2026-11-05");
    expect(esp.sourceUrl).toBe("https://www.bikedifusion.com/");
    // Lo verificado en origen pesa más que lo leído en un directorio.
    expect(esp.confidence).toBeGreaterThan(afi.confidence);
    expect(afi.method).toBe("found");
  });

  it("no inventa campos ausentes: si no se verificó, no aparece", () => {
    const r = empresaARegistro(empresa({ web: { valor: "https://bikedifusion.com", fuente: "x", metodo: "found", observado: "2026-11-05" } }))!;
    expect(r.emails).toHaveLength(0);
    expect(r.phones).toHaveLength(0);
    expect(r.extraFields!.map((f) => f.field)).not.toContain("cobertura");
    // Nada de rellenar con cadenas vacías o «desconocido».
    expect(r.extraFields!.every((f) => String(f.value).trim().length > 0)).toBe(true);
  });

  it("normaliza teléfono, email y web cuando existen", () => {
    const r = empresaARegistro(
      empresa({
        web: { valor: "https://www.bikedifusion.com/", fuente: "x", metodo: "verified", observado: "2026-11-05" },
        telefono: { valor: "+34 945 158 288", fuente: "x", metodo: "verified", observado: "2026-11-05" },
        email: { valor: "  INFO@bikedifusion.com ", fuente: "x", metodo: "verified", observado: "2026-11-05" },
      }),
    )!;
    expect(r.phones[0]!.e164).toBe("+34945158288");
    expect(r.emails[0]!.normalized).toBe("info@bikedifusion.com");
    expect(r.websites[0]!.normalized).toContain("bikedifusion.com");
  });

  it("clasifica el subtipo comercial, porque no negocian igual", () => {
    const tipo = (t: string) =>
      empresaARegistro(empresa({ tipo: { valor: t, fuente: "x", metodo: "verified", observado: "2026-11-05" } }))!.categories[0]!.categoryId;
    expect(tipo("mayorista")).toBe("distribuidor.ciclismo.mayorista");
    expect(tipo("central_de_compras")).toBe("distribuidor.ciclismo.central_compras");
    expect(tipo("marca")).toBe("distribuidor.ciclismo.marca");
    // Un tipo desconocido cae en la categoría genérica, no rompe la carga.
    expect(tipo("algo_raro")).toBe("distribuidor.ciclismo");
  });

  it("no crea registro sin nombre utilizable", () => {
    expect(empresaARegistro(empresa({}, "   "))).toBeNull();
  });

  it("guarda el registro original completo como payload, para poder auditarlo", () => {
    const e = empresa({ web: { valor: "https://bikedifusion.com", fuente: "x", metodo: "found", observado: "2026-11-05" } });
    const r = empresaARegistro(e)!;
    expect(r.payload).toMatchObject({ clave: "bikedifusion.com", nombre: "Bike Difusion" });
  });
});

describe("puertas de entrada del cargador", () => {
  const fichero = "data/distribuidores/investigacion-2026-11.json";

  it("por defecto no carga empresas sin tipo verificado", async () => {
    const { leerFicheroCurado } = await import("../../worker/sources/curados");
    const { registros, descartadas } = await leerFicheroCurado(fichero);

    // Todas las que entran declaran tipo con fuente en el fichero: ninguna se cuela sin él.
    const fuente = JSON.parse(await readFile(fichero, "utf-8")) as {
      empresas: { clave: string; campos: Record<string, { valor: string }> }[];
    };
    const conTipo = new Set(fuente.empresas.filter((e) => e.campos.tipo).map((e) => e.clave));
    expect(registros.length).toBeGreaterThan(0);
    for (const r of registros) expect(conTipo.has(r.externalId), r.name).toBe(true);

    // Y las que no lo declaran salen listadas con el motivo, no desaparecen.
    const sinTipo = fuente.empresas.filter((e) => !e.campos.tipo && !e.clave.startsWith("sin-web:")).length;
    expect(descartadas.filter((d) => /sin tipo verificado/i.test(d.motivo)).length).toBe(sinTipo - 1); // -1: Decathlon sale por cadena
  });

  it("con --generico sí las carga, y entonces son muchas más", async () => {
    const { leerFicheroCurado } = await import("../../worker/sources/curados");
    const solo = await leerFicheroCurado(fichero);
    const todas = await leerFicheroCurado(fichero, { generico: true });
    expect(todas.registros.length).toBeGreaterThan(solo.registros.length * 3);
  });

  it("Decathlon queda fuera también como distribuidor, con motivo visible", async () => {
    const { leerFicheroCurado } = await import("../../worker/sources/curados");
    for (const generico of [false, true]) {
      const { registros, descartadas } = await leerFicheroCurado(fichero, { generico });
      expect(registros.some((r) => /decathlon/i.test(r.name))).toBe(false);
      expect(descartadas.some((d) => /decathlon/i.test(d.nombre) && /cadena excluida/i.test(d.motivo))).toBe(true);
    }
  });

  it("no excluye una empresa cuyo nombre contiene el patrón dentro de una palabra", async () => {
    const { empresaARegistro } = await import("../../worker/sources/curados");
    const r = empresaARegistro({
      clave: "sprintermanbikes.com",
      nombre: "Sprinterman Bikes",
      campos: { tipo: { valor: "mayorista", fuente: "x", metodo: "verified", observado: "2026-11-06" } } as never,
      fuentes: ["x"],
    });
    expect(r).not.toBeNull();
  });

  it("entre las que entran está la central de compras, que es la mejor pista comercial", async () => {
    const { leerFicheroCurado } = await import("../../worker/sources/curados");
    const { registros } = await leerFicheroCurado(fichero);
    expect(registros.some((r) => r.categories[0]!.categoryId === "distribuidor.ciclismo.central_compras")).toBe(true);
  });
});
