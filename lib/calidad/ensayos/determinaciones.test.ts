import { describe, expect, it } from "vitest";
import { calUtilVial, humedad, pesoVolumetrico } from "./determinaciones";

/**
 * Los casos salen del archivo real (`Determinaciones 2026.xlsx`), no de la
 * imaginación: las filas donde el Excel dejó la fórmula escrita son las únicas
 * donde se puede comprobar qué cuenta se hacía.
 */

describe("humedad", () => {
  /** Hoja `Otros`, 25/09/2026, dolomita: la fórmula del Excel da 0,0091. */
  it("es (inicial − final) / (inicial − recipiente), en por ciento", () => {
    const r = humedad({ recipiente: 417.09, inicial: 539.25, final: 538.14 });
    expect(r.valor).toBe(0.91);
    expect(r.problema).toBeUndefined();
  });

  it("sin los tres pesos no hay humedad, y tampoco hay problema", () => {
    expect(humedad({ recipiente: 417.09, inicial: null, final: 538.14 }).valor).toBeNull();
    expect(humedad({ recipiente: null, inicial: null, final: null }).problema).toBeUndefined();
  });

  /**
   * El `#DIV/0!` real de `Despacho a Kartonsec` fila 27: el peso inicial igual
   * al del recipiente. En el Excel quedó el error escrito en la celda, que es
   * una de las seis formas en que ese archivo dice "no se midió".
   */
  it("avisa cuando el inicial es igual al recipiente, en vez de dividir por cero", () => {
    const r = humedad({ recipiente: 433.2, inicial: 433.2, final: 430 });
    expect(r.valor).toBeNull();
    expect(r.problema).toContain("recipiente");
  });

  /** La muestra no puede pesar más seca que húmeda: es tipeo o balanza. */
  it("muestra la humedad negativa con el aviso, no la recorta a cero", () => {
    const r = humedad({ recipiente: 400, inicial: 500, final: 510 });
    expect(r.valor).toBe(-10);
    expect(r.problema).toContain("final");
  });
});

describe("pesoVolumetrico", () => {
  /** Fila 19 de `Despacho a Kartonsec`: `=1000*299,668/330`. */
  it("son los gramos llevados a un litro", () => {
    expect(pesoVolumetrico({ gramos: 299.668, volumenCc: 330 }).valor).toBe(908.08);
  });

  it("sin gramos no hay peso volumétrico", () => {
    expect(pesoVolumetrico({ gramos: null, volumenCc: 330 }).valor).toBeNull();
  });

  /**
   * No se supone 330: en el archivo conviven 330 y 333,3 cc, que es un 1% de
   * diferencia sistemática entre hojas. Suponer uno sería reproducir el error.
   */
  it("avisa si el volumen falta o no es positivo, en vez de suponer 330", () => {
    expect(pesoVolumetrico({ gramos: 300, volumenCc: 0 }).valor).toBeNull();
    expect(pesoVolumetrico({ gramos: 300, volumenCc: 0 }).problema).toContain("recipiente");
    expect(pesoVolumetrico({ gramos: 300, volumenCc: null }).valor).toBeNull();
  });
});

describe("calUtilVial", () => {
  /**
   * La única fila del Excel con la fórmula escrita: `=41*0,037/3`, en la hoja
   * `Cal`. Da 0,5057 con formato `0%`, o sea 51% en pantalla, mientras las
   * otras dos filas de esa misma columna dicen 57,5 y 60,4 en número pelado.
   */
  it("es ml × 0,037 / peso de muestra, en por ciento", () => {
    expect(calUtilVial({ mlAcido: 41, pesoMuestraG: 3 }).valor).toBe(50.57);
  });

  it("sin ml no hay determinación", () => {
    expect(calUtilVial({ mlAcido: null, pesoMuestraG: 3 }).valor).toBeNull();
  });

  it("avisa si el peso de muestra falta o es cero", () => {
    const r = calUtilVial({ mlAcido: 41, pesoMuestraG: null });
    expect(r.valor).toBeNull();
    expect(r.problema).toContain("peso");
  });

  /** El mismo ensayo sobre 5 g da otro número, y por eso el peso va cargado. */
  it("el peso de muestra cambia el resultado", () => {
    expect(calUtilVial({ mlAcido: 41, pesoMuestraG: 5 }).valor).toBe(30.34);
  });
});
