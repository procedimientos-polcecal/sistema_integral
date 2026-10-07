import { describe, it, expect } from "vitest";
import { diaIso, fechaArgentinaDe, toUtcDateOnly } from "./dates";

describe("diaIso", () => {
  it("da el día calendario como YYYY-MM-DD", () => {
    expect(diaIso(toUtcDateOnly(2026, 9, 3))).toBe("2026-10-03");
  });

  it("rellena mes y día de un dígito", () => {
    expect(diaIso(toUtcDateOnly(2026, 0, 5))).toBe("2026-01-05");
  });

  it("es el día UTC: por eso no sirve para un instante cerca de la medianoche", () => {
    // 22:00 locales del 2 son 01:00 UTC del 3.
    const instante = new Date("2026-10-03T01:00:00Z");
    expect(diaIso(instante)).toBe("2026-10-03");
    expect(diaIso(fechaArgentinaDe(instante))).toBe("2026-10-02");
  });
});

describe("fechaArgentinaDe", () => {
  it("una salida de madrugada cae en el mismo día UTC y en el mismo día local", () => {
    // 04:00 locales = 07:00 UTC
    expect(fechaArgentinaDe(new Date("2026-10-03T07:00:00Z"))).toEqual(toUtcDateOnly(2026, 9, 3));
  });

  it("una salida a las 22:00 locales ya es el día siguiente en UTC y tiene que seguir siendo el de acá", () => {
    // 22:00 locales del 2 = 01:00 UTC del 3
    expect(fechaArgentinaDe(new Date("2026-10-03T01:00:00Z"))).toEqual(toUtcDateOnly(2026, 9, 2));
  });

  it("el borde: 00:00 locales es 03:00 UTC y ya es el día nuevo; 23:59 locales todavía es el viejo", () => {
    expect(fechaArgentinaDe(new Date("2026-10-03T03:00:00Z"))).toEqual(toUtcDateOnly(2026, 9, 3));
    expect(fechaArgentinaDe(new Date("2026-10-03T02:59:00Z"))).toEqual(toUtcDateOnly(2026, 9, 2));
  });
});
