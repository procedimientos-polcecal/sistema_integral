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
  equipo: null,
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

  it("escribe las diez columnas de entrada y ninguna mas", () => {
    expect(celdas).toHaveLength(10);
    expect([...porColumna.keys()].sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9, 10]);
  });

  it("cada dato en su columna", () => {
    expect(porColumna.get(COL.ri)).toBe("1865");
    // Con apóstrofo: se lo pide a la planilla como texto y no queda guardado.
    // El kardex cruza con Compras y con el listado **por código exacto**, así
    // que un "00469" convertido en 469 no es el mismo artículo. Ver `comoTexto`
    // en el núcleo, con los dos escenarios medidos.
    expect(porColumna.get(COL.codigo)).toBe("'00469");
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
      mov({ ri: null, descripcion: null, solicitante: null, proveedor: null, sector: null, equipo: null, fecha: null }),
      100,
      "Entradas  Salidas"
    );
    expect(sinNada).toHaveLength(10);
    const m = new Map(sinNada.map((c) => [c.columna, c.valor]));
    expect(m.get(COL.ri)).toBe("");
    expect(m.get(COL.proveedor)).toBe("");
    expect(m.get(COL.fecha)).toBe("");
  });
});

describe("el equipo va a la columna K", () => {
  it("K es la columna 10", () => {
    expect(COL.equipo).toBe(10);
  });

  it("se escribe el nombre tal como esta en la lista", () => {
    const celdas = celdasDelMovimiento(
      mov({ equipo: "PY-B1-05 - CINTA TRANSPORTADORA 3" }),
      4210,
      "Entradas  Salidas"
    );
    const k = celdas.find((c) => c.columna === COL.equipo);
    expect(k?.valor).toBe("PY-B1-05 - CINTA TRANSPORTADORA 3");
    expect(k?.fila).toBe(4210);
    expect(k?.pestana).toBe("Entradas  Salidas");
  });

  it("sin equipo se escribe vacio y no se omite la celda", () => {
    const celdas = celdasDelMovimiento(mov({ equipo: null }), 4210, "Entradas  Salidas");
    expect(celdas.find((c) => c.columna === COL.equipo)?.valor).toBe("");
  });

  /**
   * Prueba de regresion, no redundancia. La G es el saldo corriente y es una
   * formula: escribirla rompe el stock de todo lo que viene abajo. La L es
   * "¿STOCK ACTUAL<=S.S.?" y tambien es formula.
   */
  it("sigue sin tocar la G ni la L", () => {
    const columnas = celdasDelMovimiento(mov({ equipo: "PAÑOL" }), 4210, "Entradas  Salidas")
      .map((c) => c.columna);
    expect(columnas).not.toContain(6);
    expect(columnas).not.toContain(11);
  });
});

/*
 * `escribirCeldas` manda `USER_ENTERED`: lo que arranca con `=`, `+`, `-` o
 * `@` entra como formula en la planilla del almacen. El precedente es del
 * 19/10/2026, cuando un lazo de IMPORTRANGE vacio las once pestanas de
 * Compras por un dia. El nucleo lo resuelve con `textoParaLaCelda`.
 */
describe("el kardex no deja entrar una formula", () => {
  it("escapa las cinco columnas de texto", () => {
    const celdas = celdasDelMovimiento(
      mov({
        descripcion: "=IMPORTRANGE(\"https://x\";\"A1\")",
        solicitante: "-Lopez",
        proveedor: "+Ferreteria",
        sector: "@MANTENIMIENTO",
        equipo: "=A1",
      }),
      500,
      "Entradas  Salidas"
    );
    const de = (columna: number) => celdas.find((c) => c.columna === columna)?.valor;

    expect(de(COL.descripcion)).toBe("'=IMPORTRANGE(\"https://x\";\"A1\")");
    expect(de(COL.solicitante)).toBe("'-Lopez");
    expect(de(COL.proveedor)).toBe("'+Ferreteria");
    expect(de(COL.sector)).toBe("'@MANTENIMIENTO");
    expect(de(COL.equipo)).toBe("'=A1");
  });

  it("un texto normal no cambia", () => {
    const celdas = celdasDelMovimiento(mov({}), 500, "Entradas  Salidas");
    const de = (columna: number) => celdas.find((c) => c.columna === columna)?.valor;

    expect(de(COL.descripcion)).toBe("GUANTES DE DESCARNE");
    expect(de(COL.solicitante)).toBe("Lopez");
  });

  /* La otra mitad: prefijar la cantidad la volveria texto y el saldo deja de sumar. */
  it("la entrada y la salida siguen siendo numero", () => {
    const celdas = celdasDelMovimiento(
      mov({ tipo: "entrada", cantidad: 20 }), 500, "Entradas  Salidas"
    );
    expect(celdas.find((c) => c.columna === COL.entrada)?.valor).toBe("20");
  });
});
