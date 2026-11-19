import { describe, expect, it } from "vitest";
import {
  cadenaDeFechas,
  diasCorridos,
  diasDelMovimiento,
  filaDeReprogramacionDelSistema,
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

describe("filaDeReprogramacionDelSistema", () => {
  const base = {
    otId: "ot-1",
    fechaAnterior: "2026-11-06",
    fechaNueva: "2026-11-13",
    razon: "falta_repuesto",
    razonEtiqueta: "Falta de repuesto" as string | null,
    justificacion: "  Esperando la bomba  ",
    usuarioId: "u-1",
  };

  it("lleva origen 'sistema'", () => {
    expect(filaDeReprogramacionDelSistema(base).origen).toBe("sistema");
  });

  it("copia la etiqueta de la razón además del código", () => {
    const f = filaDeReprogramacionDelSistema(base);
    expect(f.razon).toBe("falta_repuesto");
    expect(f.razon_etiqueta).toBe("Falta de repuesto");
  });

  it("deja razon_etiqueta en null si la razón ya no existe", () => {
    const f = filaDeReprogramacionDelSistema({ ...base, razonEtiqueta: null });
    expect(f.razon_etiqueta).toBeNull();
  });

  it("recorta los espacios de la justificación", () => {
    expect(filaDeReprogramacionDelSistema(base).justificacion).toBe("Esperando la bomba");
  });

  it("no escribe el contador ni la fecha de creación", () => {
    const f = filaDeReprogramacionDelSistema(base);
    expect(f).not.toHaveProperty("reprogramada_veces");
    expect(f).not.toHaveProperty("creado_en");
    expect(f.ot_id).toBe("ot-1");
    expect(f.fecha_anterior).toBe("2026-11-06");
    expect(f.fecha_nueva).toBe("2026-11-13");
    expect(f.creado_por).toBe("u-1");
  });
});
