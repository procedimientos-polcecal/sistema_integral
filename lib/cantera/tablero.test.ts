import { describe, it, expect } from "vitest";
import { avisosDe, type FilaBochon, type FilaVoladura } from "./tablero";

/** Una fila mínima, sólo con los campos que `avisosDe` mira. */
function voladura(p: Partial<FilaVoladura>): FilaVoladura {
  return {
    codigo: "V01D625",
    yacimiento: "D6",
    vol_fecha: null,
    perf_fin: null,
    pozos: null,
    montoPerf: null,
    montoVol: null,
    toneladas: null,
    toneladas_planilla: null,
    desvioFuera: false,
    crucePerf: "coincide",
    cruceVol: "coincide",
    sheets_pendiente: null,
    ...p,
  };
}

function bochon(p: Partial<FilaBochon>): FilaBochon {
  return {
    codigo: "B01D625",
    yacimiento: "D6",
    fecha: null,
    voladura_codigo: null,
    cantidad: null,
    metros_perforados: null,
    monto: null,
    cruce: "coincide",
    sheets_pendiente: null,
    ...p,
  };
}

describe("avisosDe", () => {
  it("sin nada para avisar, no dice nada", () => {
    expect(avisosDe([voladura({})], [bochon({})])).toEqual([]);
  });

  it("cuenta perforación y voladura de la misma fila como dos registros a revisar", () => {
    const avisos = avisosDe([voladura({ crucePerf: "revisar", cruceVol: "sin_factura" })], []);
    expect(avisos).toEqual(["1 registro(s) con factura sin conciliar o a revisar."]);
  });

  it("un bochón sin factura también cuenta", () => {
    const avisos = avisosDe([], [bochon({ cruce: "sin_factura" })]);
    expect(avisos).toContain("1 registro(s) con factura sin conciliar o a revisar.");
  });

  it("avisa toneladas fuera de rango sólo de voladuras, no de bochones", () => {
    const avisos = avisosDe([voladura({ desvioFuera: true })], [bochon({})]);
    expect(avisos).toContain("1 voladura(s) con toneladas fuera del ±15% de la planilla histórica.");
  });

  it("avisa lo que no llegó a la planilla, sumando voladuras y bochones", () => {
    const avisos = avisosDe(
      [voladura({ sheets_pendiente: "Google devolvió 403" })],
      [bochon({ sheets_pendiente: "timeout" })]
    );
    expect(avisos).toContain("2 fila(s) que no llegaron a la planilla.");
  });

  it("junta los tres avisos cuando aplican todos", () => {
    const avisos = avisosDe(
      [voladura({ crucePerf: "revisar", desvioFuera: true, sheets_pendiente: "x" })],
      []
    );
    expect(avisos).toHaveLength(3);
  });
});
