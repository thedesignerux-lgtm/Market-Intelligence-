// Exclusión comercial de cadenas: no debe tocar a ninguna tienda independiente.
import { describe, expect, it } from "vitest";
import { cadenaExcluida } from "../../src/lib/domain/exclusiones";

describe("cadenas excluidas de la captación", () => {
  it("excluye las cadenas decididas, con o sin sucursal en el nombre", () => {
    for (const n of ["Decathlon", "DECATHLON", "Decathlon Diagonal Mar", "Décathlon", "Sprinter", "Sprinter Gran Vía"]) {
      expect(cadenaExcluida(n), n).not.toBeNull();
    }
  });

  it("reconoce la cadena tras un separador que no es espacio", () => {
    expect(cadenaExcluida("Centro Comercial - Decathlon")).not.toBeNull();
    expect(cadenaExcluida("(Decathlon) Sants")).not.toBeNull();
  });

  it("NO excluye tiendas independientes cuyo nombre contiene el patrón dentro de una palabra", () => {
    for (const n of ["Bicicletas Sprinterman", "Elsprinter Bikes", "Mydecathlon Store"]) {
      expect(cadenaExcluida(n), n).toBeNull();
    }
  });

  it("NO excluye tiendas normales", () => {
    for (const n of ["Bicicletas Salchi", "Biking Point", "Va de Bici", "Trek Pontevedra", "Cicles Sans"]) {
      expect(cadenaExcluida(n), n).toBeNull();
    }
  });

  it("devuelve un motivo legible, no solo verdadero", () => {
    expect(cadenaExcluida("Decathlon")).toMatch(/precios centralizados/i);
  });
});
