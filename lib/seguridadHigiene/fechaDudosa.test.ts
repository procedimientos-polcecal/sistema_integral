import { describe, expect, it } from "vitest";
import { fechaDudosaDelExcel } from "./fechaDudosa";

describe("fechaDudosaDelExcel", () => {
  it("marca las cinco condiciones del Excel con la fecha dudosa que traían", () => {
    expect(fechaDudosaDelExcel(42, "2026-11-13")).toContain("11 por un 10");
    expect(fechaDudosaDelExcel(43, "2026-11-13")).toContain("11 por un 10");
    expect(fechaDudosaDelExcel(44, "2026-11-13")).toContain("11 por un 10");
    expect(fechaDudosaDelExcel(7, "2026-01-10")).toContain("al revés");
    expect(fechaDudosaDelExcel(6, "2026-10-10")).toContain("la más floja");
  });

  it("deja de marcarla en cuanto la fecha se corrige", () => {
    expect(fechaDudosaDelExcel(42, "2026-10-13")).toBeNull();
    expect(fechaDudosaDelExcel(7, "2026-10-01")).toBeNull();
    expect(fechaDudosaDelExcel(6, "2026-10-06")).toBeNull();
  });

  it("no marca una condición que no es de las cinco, aunque la fecha coincida", () => {
    expect(fechaDudosaDelExcel(5, "2026-10-10")).toBeNull();
    expect(fechaDudosaDelExcel(46, "2026-11-13")).toBeNull();
  });

  it("dice siempre que no está confirmada", () => {
    for (const [n, f] of [[42, "2026-11-13"], [7, "2026-01-10"], [6, "2026-10-10"]] as const) {
      expect(fechaDudosaDelExcel(n, f)).toContain("Sin confirmar");
    }
  });
});
