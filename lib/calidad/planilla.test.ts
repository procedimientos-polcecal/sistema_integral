import { describe, it, expect } from "vitest";
import { filaDeLaPlanilla, CODIGOS_DE_CONSUMO, CODIGOS_DE_AJUSTE } from "./planilla";

const carbonillero = { nombre_planilla: "BRUZZONE JUAN ALBERTO", codigo_planilla: "00003" };
const saldos = { saldoTotal: 345.997, saldoVegetal: 269.9, saldoResidual: 76.097 };

describe("filaDeLaPlanilla", () => {
  it("una entrada: código y nombre del carbonillero, y las toneladas en ENTRADAS", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "entrada", carbon: "vegetal", toneladas: 19.58, fecha: "2026-09-04" },
      { carbonillero, ...saldos }
    );
    expect(fila).toEqual([
      "00003",
      "BRUZZONE JUAN ALBERTO",
      19.58,
      "",
      345.997,
      269.9,
      76.097,
      46269,
      "",
      "",
    ]);
  });

  it("un consumo vegetal: el código 00015 y las toneladas en SALIDAS, en positivo", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "consumo", carbon: "vegetal", toneladas: -37, fecha: "2026-09-04" },
      saldos
    );
    expect(fila[0]).toBe(CODIGOS_DE_CONSUMO.vegetal);
    expect(fila[1]).toBe("CONSUMO VEGETAL");
    expect(fila[2]).toBe("");
    expect(fila[3]).toBe(37);
  });

  it("un consumo residual usa el 00016", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "consumo", carbon: "residual", toneladas: -12, fecha: "2026-09-04" },
      saldos
    );
    expect(fila[0]).toBe(CODIGOS_DE_CONSUMO.residual);
    expect(fila[1]).toBe("CONSUMO RESIDUAL");
  });

  it("un ajuste en menos cae en SALIDAS", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "ajuste", carbon: "vegetal", toneladas: -46, fecha: "2026-04-20" },
      saldos
    );
    expect(fila[0]).toBe(CODIGOS_DE_AJUSTE.vegetal);
    expect(fila[1]).toBe("AJUSTE VEGETAL");
    expect(fila[2]).toBe("");
    expect(fila[3]).toBe(46);
    expect(fila[7]).toBe(46132);
  });

  it("un ajuste en más cae en ENTRADAS — lo que la fórmula vieja no sabía hacer", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "ajuste", carbon: "vegetal", toneladas: 232.5, fecha: "2026-05-02" },
      saldos
    );
    expect(fila[2]).toBe(232.5);
    expect(fila[3]).toBe("");
    expect(fila[7]).toBe(46144);
  });

  it("la fecha va como serial y nunca como texto", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "consumo", carbon: "vegetal", toneladas: -37, fecha: "2026-09-09" },
      saldos
    );
    expect(typeof fila[7]).toBe("number");
    // 46274 es el serial que la planilla real tiene en las filas del 09/09/2026.
    expect(fila[7]).toBe(46274);
  });

  it("el conteo físico y su desvío, cuando el movimiento los trae", () => {
    const fila = filaDeLaPlanilla(
      { tipo: "consumo", carbon: "vegetal", toneladas: -29, fecha: "2026-09-11" },
      { ...saldos, conteo: { contadas: 298, desvio: -28.857 } }
    );
    expect(fila[8]).toBe(298);
    expect(fila[9]).toBe(-28.857);
  });

  it("una entrada sin su carbonillero no se escribe a medias: falla", () => {
    expect(() =>
      filaDeLaPlanilla(
        { tipo: "entrada", carbon: "vegetal", toneladas: 19.58, fecha: "2026-09-04" },
        saldos
      )
    ).toThrow();
  });

  it("un sin_separar no se escribe: la planilla ya lo tiene", () => {
    expect(() =>
      filaDeLaPlanilla(
        { tipo: "consumo", carbon: "sin_separar", toneladas: -46, fecha: "2025-09-30" },
        saldos
      )
    ).toThrow();
  });

  it("una fecha imposible no se escribe en silencio", () => {
    expect(() =>
      filaDeLaPlanilla(
        { tipo: "consumo", carbon: "vegetal", toneladas: -37, fecha: "2026-02-30" },
        saldos
      )
    ).toThrow();
  });
});
