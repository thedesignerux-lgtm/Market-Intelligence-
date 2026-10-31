import { describe, expect, it } from "vitest";
import { CCAA, PROVINCES, provincesForScope } from "../../src/lib/domain/territory";

describe("territorio", () => {
  it("cubre las 52 provincias y 19 comunidades, cada provincia con comunidad y extracto", () => {
    expect(PROVINCES).toHaveLength(52);
    expect(CCAA).toHaveLength(19);
    expect(new Set(PROVINCES.map((p) => p.code)).size).toBe(52);
    for (const p of PROVINCES) {
      expect(CCAA.some((c) => c.code === p.ccaa)).toBe(true);
      expect(p.extract).toMatch(/^(europe|africa)\/spain\/[a-z_/]+$/);
    }
  });

  it("traduce ámbitos a provincias", () => {
    expect(provincesForScope("galicia")).toEqual(["15", "27", "32", "36"]);
    expect(provincesForScope("España")).toHaveLength(52);
    expect(provincesForScope("28")).toEqual(["28"]);
    expect(provincesForScope("99")).toBeNull();
    expect(provincesForScope("15078")).toBeNull();
  });
});
