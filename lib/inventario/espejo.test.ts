import { describe, it, expect } from "vitest";
import {
  celdasDelMovimiento, entradaYSalida, fechaParaLaPlanilla, COL,
  type MovimientoAEspejar,
} from "./espejo";

const mov = (p: Partial<MovimientoAEspejar>): MovimientoAEspejar => ({
  ri: null,
  codigo: "00469",
  descripcion: "GUANTES DE DESCARNE",
  tipo: "salida",
  cantidad: 5,
  stock_anterior: 42,
  stock_resultante: 37,
  solicitante: "Lopez",
  proveedor: null,
  sector: "MANTENIMIENTO",
  fecha: "2026-09-02",
  ...p,
});

describe("cuanto entra y cuanto sale", () => {
  it("una entrada llena la columna de entrada", () => {
    expect(entradaYSalida(mov({ tipo: "entrada", cantidad: 20 })))
      .toEqual({ entrada: "20", salida: "" });
  });

  it("una salida llena la de salida", () => {
    expect(entradaYSalida(mov({ tipo: "salida", cantidad: 5 })))
      .toEqual({ entrada: "", salida: "5" });
  });

  /**
   * La planilla no conoce el ajuste: tiene entrada y salida y nada mas. Un
   * ajuste va como la diferencia contra el stock que habia, para el lado que
   * corresponda, que es lo que mantiene coherente la formula del saldo.
   */
  it("un ajuste hacia arriba se escribe como entrada de la diferencia", () => {
    const m = mov({ tipo: "ajuste", cantidad: 50, stock_anterior: 42, stock_resultante: 50 });
    expect(entradaYSalida(m)).toEqual({ entrada: "8", salida: "" });
  });

  it("un ajuste hacia abajo se escribe como salida de la diferencia", () => {
    const m = mov({ tipo: "ajuste", cantidad: 30, stock_anterior: 42, stock_resultante: 30 });
    expect(entradaYSalida(m)).toEqual({ entrada: "", salida: "12" });
  });

  it("un ajuste que no mueve nada no escribe ninguna de las dos", () => {
    const m = mov({ tipo: "ajuste", cantidad: 42, stock_anterior: 42, stock_resultante: 42 });
    expect(entradaYSalida(m)).toEqual({ entrada: "", salida: "" });
  });
});

/** La planilla escribe d/m, no m/d: leerlo al reves dio vuelta 885 fechas en Compras. */
describe("la fecha como la escribe la planilla", () => {
  it("va en d/m/aaaa y sin ceros de relleno", () => {
    expect(fechaParaLaPlanilla("2026-09-02")).toBe("2/9/2026");
    expect(fechaParaLaPlanilla("2026-12-25")).toBe("25/12/2026");
  });

  it("sin fecha queda vacia", () => {
    expect(fechaParaLaPlanilla(null)).toBe("");
    expect(fechaParaLaPlanilla("")).toBe("");
  });
});

describe("que celdas se escriben", () => {
  const celdas = celdasDelMovimiento(mov({ ri: 1865 }), 4210, "Entradas  Salidas");
  const porColumna = new Map(celdas.map((c) => [c.columna, c.valor]));

  /**
   * La G es el saldo corriente y es una FORMULA: escribirla la rompe y con ella
   * el stock de todo lo que viene abajo. Es la regla mas importante de todo el
   * espejo.
   */
  it("NUNCA se escribe la columna G, que es la formula del saldo", () => {
    expect(celdas.some((c) => c.columna === 6)).toBe(false);
  });

  it("escribe las nueve columnas de entrada y ninguna mas", () => {
    expect(celdas).toHaveLength(9);
    expect([...porColumna.keys()].sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9]);
  });

  it("cada dato en su columna", () => {
    expect(porColumna.get(COL.ri)).toBe("1865");
    expect(porColumna.get(COL.codigo)).toBe("00469");
    expect(porColumna.get(COL.descripcion)).toBe("GUANTES DE DESCARNE");
    expect(porColumna.get(COL.salida)).toBe("5");
    expect(porColumna.get(COL.entrada)).toBe("");
    expect(porColumna.get(COL.solicitante)).toBe("Lopez");
    expect(porColumna.get(COL.fecha)).toBe("2/9/2026");
    expect(porColumna.get(COL.sector)).toBe("MANTENIMIENTO");
  });

  it("todas van a la misma fila y a la misma pestana", () => {
    expect(celdas.every((c) => c.fila === 4210)).toBe(true);
    expect(celdas.every((c) => c.pestana === "Entradas  Salidas")).toBe(true);
  });

  /**
   * Se escriben vacias y no se omiten: si la fila anterior tenia algo ahi y esta
   * no, omitirla dejaria el dato viejo en la fila nueva.
   */
  it("lo que no tiene valor se escribe vacio, no se omite", () => {
    const sinNada = celdasDelMovimiento(
      mov({ ri: null, descripcion: null, solicitante: null, proveedor: null, sector: null, fecha: null }),
      100,
      "Entradas  Salidas"
    );
    expect(sinNada).toHaveLength(9);
    const m = new Map(sinNada.map((c) => [c.columna, c.valor]));
    expect(m.get(COL.ri)).toBe("");
    expect(m.get(COL.proveedor)).toBe("");
    expect(m.get(COL.fecha)).toBe("");
  });
});
