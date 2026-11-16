import { describe, expect, it } from "vitest";
import { curvaDeLaMuestra } from "./curva";

/**
 * La muestra real de `Calcio 0-2` del 27/10/2026. Con el peso en 100 g los
 * gramos **son** los porcentajes, así que el fixture reproduce la curva real
 * sin inventar nada.
 */
const MUESTRA = {
  pesoMuestraG: 100,
  retenidos: [
    { malla: 6, retenido_g: 0 },
    { malla: 7, retenido_g: 0 },
    { malla: 10, retenido_g: 0.2 },
    { malla: 12, retenido_g: 0.7 },
    { malla: 20, retenido_g: 6.0 },
    { malla: 50, retenido_g: 34.7 },
    { malla: 100, retenido_g: 14.4 },
    { malla: 200, retenido_g: 10.4 },
  ],
};

const TODAS = [6, 7, 10, 12, 20, 50, 100, 200];

describe("curvaDeLaMuestra", () => {
  it("sin nada apagado dibuja todas las mallas medidas", () => {
    const curva = curvaDeLaMuestra(MUESTRA, []);

    expect(curva.mallas).toEqual(TODAS);
    expect(curva.puntos).toHaveLength(8);
    expect(curva.puntos[7]).toEqual({ malla: 200, retenido: 10.4, acumulado: 66.4, pasante: 33.6 });
  });

  it("apagar un tamiz le saca el punto y no toca ningun otro numero", () => {
    const curva = curvaDeLaMuestra(MUESTRA, [20]);

    expect(curva.puntos.map((p) => p.malla)).not.toContain(20);
    expect(curva.puntos).toHaveLength(7);
    // La propiedad sobre la que se apoya todo el diseño: el acumulado de #50
    // ya incluye lo que retuvo #20. Recalcular sin ella daría 35,6, que nadie midió.
    expect(curva.puntos.find((p) => p.malla === 50)?.acumulado).toBe(41.6);
  });

  it("las mallas siguen estando aunque esten apagadas", () => {
    const curva = curvaDeLaMuestra(MUESTRA, [20]);

    expect(curva.mallas).toEqual(TODAS);
  });

  it("apagar todos deja una curva sin puntos y sin problema", () => {
    const curva = curvaDeLaMuestra(MUESTRA, TODAS);

    expect(curva.puntos).toEqual([]);
    expect(curva.problema).toBeUndefined();
  });

  it("una muestra sin peso devuelve el problema que ya escribe granulometria", () => {
    const curva = curvaDeLaMuestra({ ...MUESTRA, pesoMuestraG: null }, []);

    expect(curva.problema).toBe("Falta el peso de la muestra tamizada.");
    expect(curva.puntos).toEqual([]);
    // La pantalla ramifica sobre esto: sin mallas muestra el problema, y con
    // mallas dibujaría chips y dos gráficos vacíos sin explicar por qué.
    expect(curva.mallas).toEqual([]);
  });

  it("los retenidos en cero son dato y se dibujan", () => {
    const curva = curvaDeLaMuestra(MUESTRA, []);

    expect(curva.puntos).toContainEqual({ malla: 6, retenido: 0, acumulado: 0, pasante: 100 });
  });

  it("una malla apagada que la muestra no midio no cambia nada", () => {
    expect(curvaDeLaMuestra(MUESTRA, [325])).toEqual(curvaDeLaMuestra(MUESTRA, []));
  });

  it("el pasante es el complemento del acumulado", () => {
    const curva = curvaDeLaMuestra(MUESTRA, []);

    expect(curva.puntos.map((p) => p.pasante)).toEqual([100, 100, 99.8, 99.1, 93.1, 58.4, 44, 33.6]);
  });

  it("el pasante se redondea a dos decimales como los otros dos", () => {
    const curva = curvaDeLaMuestra(MUESTRA, []);

    // 100 - 66.4 en coma flotante da 33.599999999999994: sin redondear, el
    // número que llega a la pantalla y al Excel trae cola.
    expect(100 - 66.4).not.toBe(33.6);
    expect(curva.puntos.find((p) => p.malla === 200)?.pasante).toBe(33.6);
    for (const p of curva.puntos) {
      expect(p.pasante).toBe(Math.round(p.pasante * 100) / 100);
    }
  });

  it("una muestra cuyos retenidos superan el peso da pasante negativo", () => {
    const curva = curvaDeLaMuestra({ ...MUESTRA, pesoMuestraG: 50 }, []);

    // Con 50 g pesados y 66,4 g retenidos el acumulado llega a 132,8: se muestra
    // como da. Recortarlo a 0 escondería justo la muestra que hay que corregir.
    const ultimo = curva.puntos[curva.puntos.length - 1];
    expect(ultimo.acumulado).toBe(132.8);
    expect(ultimo.pasante).toBeLessThan(0);
    expect(ultimo.pasante).toBe(-32.8);
    expect(curva.problema).toBeDefined();
  });

  it("apagar una malla no cambia el pasante de las demas", () => {
    const todas = curvaDeLaMuestra(MUESTRA, []);
    const sin20 = curvaDeLaMuestra(MUESTRA, [20]);

    for (const p of sin20.puntos) {
      expect(p.pasante).toBe(todas.puntos.find((q) => q.malla === p.malla)?.pasante);
    }
  });
});
