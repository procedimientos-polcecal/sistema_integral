import { describe, expect, it } from "vitest";
import {
  cadenaDeFechas,
  diasCorridos,
  diasDelMovimiento,
  type Reprogramacion,
} from "./reprogramaciones";

function mov(
  anterior: string | null,
  nueva: string,
  creadoEn = "2026-11-01T10:00:00Z",
): Reprogramacion {
  return {
    id: `id-${anterior}-${nueva}`,
    ot_id: "ot-1",
    fecha_anterior: anterior,
    fecha_nueva: nueva,
    origen: "sistema",
    razon: null,
    razon_etiqueta: null,
    justificacion: null,
    creado_por: null,
    creado_en: creadoEn,
  };
}

const TRES = [
  mov("2026-11-06", "2026-11-13", "2026-11-02T10:00:00Z"),
  mov("2026-11-13", "2026-11-20", "2026-11-03T10:00:00Z"),
  mov("2026-11-20", "2026-11-27", "2026-11-04T10:00:00Z"),
];

describe("cadenaDeFechas", () => {
  it("con un movimiento da las dos fechas", () => {
    expect(
      cadenaDeFechas([mov("2026-11-06", "2026-11-13")], "2026-11-13"),
    ).toEqual(["2026-11-06", "2026-11-13"]);
  });

  it("con tres movimientos encadena las cuatro y no repite", () => {
    expect(cadenaDeFechas(TRES, "2026-11-27")).toEqual([
      "2026-11-06",
      "2026-11-13",
      "2026-11-20",
      "2026-11-27",
    ]);
  });

  it("sin movimientos da sólo la vigente", () => {
    expect(cadenaDeFechas([], "2026-11-27")).toEqual(["2026-11-27"]);
  });

  it("sin movimientos y sin fecha vigente da la lista vacía", () => {
    expect(cadenaDeFechas([], null)).toEqual([]);
  });

  it("ignora un fecha_anterior nulo al principio de la cadena", () => {
    expect(
      cadenaDeFechas([mov(null, "2026-11-13")], "2026-11-13"),
    ).toEqual(["2026-11-13"]);
  });

  it("termina en la fecha vigente aunque no sea la del último movimiento", () => {
    // La sincronización la movió después del último movimiento registrado.
    expect(
      cadenaDeFechas([mov("2026-11-06", "2026-11-13")], "2026-11-18"),
    ).toEqual(["2026-11-06", "2026-11-13", "2026-11-18"]);
  });
});

describe("diasCorridos", () => {
  it("suma los tres tramos de una cadena de tres", () => {
    expect(diasCorridos(TRES, "2026-11-27")).toBe(21);
  });

  it("da negativo si la fecha se movió hacia atrás", () => {
    expect(
      diasCorridos([mov("2026-11-13", "2026-11-09")], "2026-11-09"),
    ).toBe(-4);
  });

  it("da 0 sin movimientos", () => {
    expect(diasCorridos([], "2026-11-27")).toBe(0);
    expect(diasCorridos([], null)).toBe(0);
  });
});

describe("diasDelMovimiento", () => {
  it("da los días entre las dos fechas", () => {
    expect(diasDelMovimiento(mov("2026-11-06", "2026-11-13"))).toBe(7);
  });

  it("da null si no hay fecha anterior", () => {
    expect(diasDelMovimiento(mov(null, "2026-11-13"))).toBeNull();
  });
});
