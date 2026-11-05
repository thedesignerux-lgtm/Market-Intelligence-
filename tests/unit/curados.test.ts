// Traducción del fichero de investigación a registros normalizados.
// Lo que se vigila aquí es que no se invente nada y que cada dato conserve su procedencia.
import { describe, expect, it } from "vitest";
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
