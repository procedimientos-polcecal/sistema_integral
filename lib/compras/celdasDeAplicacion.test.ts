import { describe, it, expect } from "vitest";
import { celdasDeAplicacion } from "./seguimiento";

/**
 * Los dos encabezados son los REALES del libro, leídos el 16/09/2026.
 * Mantenimiento tiene 21 columnas y las demás 18: `Estimada Aplicación`,
 * `ANALISIS` y `Equipo` existen sólo ahí, **en el medio**. Por eso las columnas
 * se ubican por nombre y nunca por posición: con un índice fijo, la fecha de
 * Mantenimiento caería en `ANALISIS`.
 */
const MANTENIMIENTO = [
  "NºRI", "CODIGO", "AREA", "Descripción", "Proveedor", "¿Quién compro?",
  "Cant Pedida", "Cant Recibida", "Fecha estimada", "Fecha de recepción", "",
  "Cumplió COMPRAS?", "Cumplió PROV?",
  "Se aplicó?", "Estimada Aplicación", "ANALISIS", "Fecha de Aplicación",
  "Equipo", "Tiempo en Stock", "Capital", "OBSERVACIONES",
];

const ALMACEN = [
  "NºRI", "CODIGO", "AREA", "Descripción", "Proveedor", "¿Quién compro?",
  "Cant Pedida", "Cant Recibida", "Fecha estimada", "Fecha de recepción", "",
  "Cumplió COMPRAS?", "Cumplió PROV?",
  "Se aplicó?", "Fecha de Aplicación", "Tiempo en Stock", "Capital", "OBSERVACIONES",
];

const TODO = { seAplico: "SI", fechaAplicacion: "2026-09-04" };

describe("celdasDeAplicacion", () => {
  it("ubica las columnas por nombre y no por posición", () => {
    const m = celdasDeAplicacion(MANTENIMIENTO, [], TODO);
    expect(m.aEscribir.map((c) => c.columna)).toEqual([13, 16]);

    const a = celdasDeAplicacion(ALMACEN, [], TODO);
    expect(a.aEscribir.map((c) => c.columna)).toEqual([13, 14]);
  });

  it("escribe el «Si» como lo tiene la planilla, y la fecha como serial", () => {
    const { aEscribir } = celdasDeAplicacion(ALMACEN, [], TODO);
    expect(aEscribir).toEqual([
      { columna: 13, valor: "Si" },
      { columna: 14, valor: "46269" },
    ]);
  });

  /**
   * LA REGLA QUE MÁS IMPORTA. En Almacén la columna entera de `Fecha de
   * Aplicación` es `=J` —599 de 599 celdas medidas—, o sea que copia la fecha
   * de recepción; en Taller Vial son 539 de 599. Escribir ahí rompería el
   * cálculo, y el libro no tiene deshacer.
   */
  it("no pisa una celda que es fórmula, y dice cuál salteó", () => {
    const r = celdasDeAplicacion(ALMACEN, [14], TODO);
    expect(r.aEscribir).toEqual([{ columna: 13, valor: "Si" }]);
    expect(r.salteadas).toEqual(["Fecha de Aplicación (es una fórmula en la planilla)"]);
  });

  /**
   * Null es "no corresponde escribir esta celda", igual que `solicita` y
   * `comparativa` en el otro libro. Es lo que deja que el área siga tildando a
   * mano en la planilla sin que el sistema se lo borre con un vacío.
   */
  it("lo que el sistema no sabe no se escribe, y no se escribe vacío", () => {
    const r = celdasDeAplicacion(ALMACEN, [], { seAplico: null, fechaAplicacion: null });
    expect(r.aEscribir).toEqual([]);
    expect(r.salteadas).toEqual([]);
  });

  it("se puede saber que se aplicó sin saber cuándo", () => {
    const r = celdasDeAplicacion(MANTENIMIENTO, [], { seAplico: "NO", fechaAplicacion: null });
    expect(r.aEscribir).toEqual([{ columna: 13, valor: "No" }]);
  });

  /** Una fecha imposible deja la celda quieta en vez de correrla tres días. */
  it("una fecha que no existe no se escribe", () => {
    const r = celdasDeAplicacion(ALMACEN, [], { seAplico: null, fechaAplicacion: "2026-02-30" });
    expect(r.aEscribir).toEqual([]);
  });

  /**
   * Si la pestaña no tiene la columna, se dice. Callarlo dejaría el dato en la
   * base y nadie sabría por qué no aparece en la planilla.
   */
  it("una columna que la pestaña no tiene se informa", () => {
    const sinFecha = ALMACEN.filter((h) => h !== "Fecha de Aplicación");
    const r = celdasDeAplicacion(sinFecha, [], TODO);
    expect(r.aEscribir).toEqual([{ columna: 13, valor: "Si" }]);
    expect(r.salteadas).toEqual(["Fecha de Aplicación (la pestaña no tiene esa columna)"]);
  });

  it("tolera acentos, mayúsculas y espacios de más en el encabezado", () => {
    const raro = ALMACEN.map((h) => `  ${h.toUpperCase()}  `);
    expect(celdasDeAplicacion(raro, [], TODO).aEscribir.map((c) => c.columna)).toEqual([13, 14]);
  });
});
