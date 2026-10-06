import { describe, expect, it } from "vitest";
import { granulometria } from "./granulometria";

describe("granulometria", () => {
  /**
   * La fila 150 de `Filler 1` (14/07/2026), que en el Excel cierra exacta:
   * 0 + 2,5 + 16,6 = 19,1 y 19,1 + 18,8 = 37,9. Reconstruida en gramos sobre
   * una muestra de 100 g, que es lo que la vuelve comprobable.
   *
   * Los retenidos entran desordenados a propósito: el orden lo pone la malla,
   * no quien los cargó.
   */
  it("acumula de mayor a menor abertura", () => {
    const r = granulometria({
      pesoMuestraG: 100,
      retenidos: [
        { malla: 325, retenido_g: 18.8 },
        { malla: 50, retenido_g: 0 },
        { malla: 200, retenido_g: 16.6 },
        { malla: 100, retenido_g: 2.5 },
      ],
    });

    expect(r.filas.map((f) => f.malla)).toEqual([50, 100, 200, 325]);
    expect(r.filas.map((f) => f.retenido.valor)).toEqual([0, 2.5, 16.6, 18.8]);
    expect(r.filas.map((f) => f.acumulado.valor)).toEqual([0, 2.5, 19.1, 37.9]);
    expect(r.problema).toBeUndefined();
  });

  /**
   * El acumulado deja de ser algo que alguien pueda tipear distinto. En el
   * Excel no cerraba en 32 filas; acá no hay forma de que no cierre.
   */
  it("el acumulado de la última malla es la suma de todo lo retenido", () => {
    const r = granulometria({
      pesoMuestraG: 20,
      retenidos: [
        { malla: 10, retenido_g: 1 },
        { malla: 20, retenido_g: 2 },
        { malla: 50, retenido_g: 3 },
      ],
    });
    expect(r.filas.at(-1)?.acumulado.valor).toBe(30);
  });

  /**
   * El porcentaje sale contra el peso de la muestra, así que tamizar sobre 50 g
   * en vez de 20 sigue dando el número bien. En el Excel el divisor estaba
   * escrito en la fórmula (`=K4/20`) y cambiarlo era editar celda por celda.
   */
  it("el peso de la muestra es el divisor, no una constante", () => {
    const retenidos = [{ malla: 50, retenido_g: 5 }];
    expect(granulometria({ pesoMuestraG: 20, retenidos }).filas[0].retenido.valor).toBe(25);
    expect(granulometria({ pesoMuestraG: 50, retenidos }).filas[0].retenido.valor).toBe(10);
  });

  it("sin peso de muestra no hay granulometría", () => {
    const r = granulometria({ pesoMuestraG: null, retenidos: [{ malla: 50, retenido_g: 1 }] });
    expect(r.filas).toEqual([]);
    expect(r.problema).toContain("peso");
  });

  it("sin retenidos no hay filas y tampoco hay problema", () => {
    expect(granulometria({ pesoMuestraG: 20, retenidos: [] })).toEqual({ filas: [] });
  });

  /**
   * Más retenido que muestra es imposible. Se muestra igual, con el aviso: es
   * la misma regla que la producción negativa en Producción — recortarlo
   * escondería justo lo que hay que corregir.
   */
  it("avisa cuando lo retenido supera la muestra, y muestra las filas igual", () => {
    const r = granulometria({
      pesoMuestraG: 20,
      retenidos: [
        { malla: 50, retenido_g: 15 },
        { malla: 100, retenido_g: 10 },
      ],
    });
    expect(r.filas).toHaveLength(2);
    expect(r.filas.at(-1)?.acumulado.valor).toBe(125);
    expect(r.problema).toContain("supera");
  });
});
