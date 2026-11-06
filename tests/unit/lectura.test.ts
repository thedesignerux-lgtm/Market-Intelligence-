// La previsualización debe pararse si no puede garantizar que ve los datos.
//
// El caso que motiva esto: un rol de solo lectura sin BYPASSRLS no falla al consultar,
// devuelve cero filas. El informe saldría vacío y parecería correcto.
import { describe, expect, it } from "vitest";
import { garantizarLectura, diagnosticarLectura, LecturaNoGarantizada } from "../../worker/lectura";
import type { Db } from "../../worker/db";

interface Estado {
  usuario?: string;
  superusuario?: boolean;
  bypassrls?: boolean;
  /** Tablas con RLS activa que NO pertenecen al usuario actual. */
  tablasConRls?: string[];
  mappingsOsm?: number;
}

function db(e: Estado = {}): Db {
  const query = async (text: string) => {
    if (text.includes("current_user as usuario")) {
      return {
        rowCount: 1,
        rows: [{ usuario: e.usuario ?? "previsualizador", superusuario: e.superusuario ?? false, bypassrls: e.bypassrls ?? true }],
      };
    }
    if (text.includes("relrowsecurity")) {
      return { rowCount: 0, rows: (e.tablasConRls ?? []).map((relname) => ({ relname })) };
    }
    if (text.includes("category_mappings")) {
      return { rowCount: 1, rows: [{ n: e.mappingsOsm ?? 7 }] };
    }
    return { rowCount: 0, rows: [] };
  };
  return { query } as unknown as Db;
}

describe("garantía de lectura", () => {
  it("deja pasar a un rol con bypassrls que ve las reglas de categorías", async () => {
    const d = await garantizarLectura(db({ bypassrls: true, mappingsOsm: 7 }));
    expect(d.bypassrls).toBe(true);
    expect(d.mappingsOsm).toBe(7);
  });

  it("se detiene si RLS puede estar filtrando filas en silencio", async () => {
    const p = garantizarLectura(db({ bypassrls: false, tablasConRls: ["entities", "category_mappings"] }));
    await expect(p).rejects.toBeInstanceOf(LecturaNoGarantizada);
    await expect(p).rejects.toThrow(/cero filas/i);
    // El mensaje tiene que decir cómo arreglarlo, no solo que falla.
    await expect(p).rejects.toThrow(/bypassrls/i);
  });

  it("nombra las tablas afectadas, para poder diagnosticarlo", async () => {
    await expect(garantizarLectura(db({ bypassrls: false, tablasConRls: ["contact_points"] }))).rejects.toThrow(/contact_points/);
  });

  it("se detiene si no ve ninguna regla de categorías de osm", async () => {
    const p = garantizarLectura(db({ bypassrls: true, mappingsOsm: 0 }));
    await expect(p).rejects.toBeInstanceOf(LecturaNoGarantizada);
    await expect(p).rejects.toThrow(/0 candidatos|cero|ninguna regla/i);
  });

  it("un superusuario no dispara el aviso aunque haya RLS activa", async () => {
    const d = await garantizarLectura(db({ superusuario: true, bypassrls: false, tablasConRls: ["entities"] }));
    expect(d.tablasFiltradas).toEqual([]);
  });

  it("el diagnóstico no ejecuta ninguna escritura", async () => {
    const sql: string[] = [];
    const espia = {
      query: async (text: string) => {
        sql.push(text);
        if (text.includes("current_user as usuario")) return { rowCount: 1, rows: [{ usuario: "u", superusuario: false, bypassrls: true }] };
        if (text.includes("category_mappings")) return { rowCount: 1, rows: [{ n: 7 }] };
        return { rowCount: 0, rows: [] };
      },
    } as unknown as Db;
    await diagnosticarLectura(espia);
    expect(sql.every((s) => /^\s*select\b/i.test(s.trim()))).toBe(true);
  });
});
