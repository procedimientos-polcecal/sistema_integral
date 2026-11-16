import { describe, it, expect } from "vitest";
import { comoSeLeeElPeriodo } from "./auditoriaDelPeriodo";

describe("comoSeLeeElPeriodo", () => {
  it("dice el año, el rango y los días, que es lo que se pierde al corregir", () => {
    expect(
      comoSeLeeElPeriodo({
        anio_correspondiente: 2025,
        fecha_desde: "2026-07-27",
        fecha_hasta: "2026-08-03",
        dias_tomados: 8,
        observaciones: null,
      }),
    ).toBe("Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días)");
  });

  it("corta el timestamp que a veces devuelve la base", () => {
    expect(
      comoSeLeeElPeriodo({
        anio_correspondiente: 2025,
        fecha_desde: "2026-07-27T00:00:00+00:00",
        fecha_hasta: "2026-08-03T00:00:00+00:00",
        dias_tomados: 8,
        observaciones: null,
      }),
    ).toBe("Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días)");
  });

  it("agrega las observaciones cuando las hay", () => {
    expect(
      comoSeLeeElPeriodo({
        anio_correspondiente: 2025,
        fecha_desde: "2026-07-27",
        fecha_hasta: "2026-08-03",
        dias_tomados: 8,
        observaciones: "  adelanta una semana  ",
      }),
    ).toBe("Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días) — adelanta una semana");
  });

  it("unas observaciones en blanco no agregan el guión", () => {
    expect(
      comoSeLeeElPeriodo({
        anio_correspondiente: 2025,
        fecha_desde: "2026-07-27",
        fecha_hasta: "2026-08-03",
        dias_tomados: 8,
        observaciones: "   ",
      }),
    ).toBe("Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días)");
  });
});
