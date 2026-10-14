import { describe, it, expect } from "vitest";
import {
  filaSiguienteSegunLaColumna, laPlanillaEncogio, tramosDeLaFila,
} from "./sheets";

/**
 * El caso real, y el que no estaba cubierto: el 13/10/2026 la pestaña `OT`
 * estuvo vacia entre que alguien la borro (11:22) y la restauro (12:13). A las
 * 12:09 se creo una OT desde la app, que leyo la columna A, encontro dos filas
 * y escribio en la 3 — encima de donde vive la OT 623.
 */
describe("si la planilla encogio", () => {
  it("menos filas de las que sabemos que hay: no se escribe", () => {
    // Lo que paso de verdad: 2 filas leidas, 2157 anotadas.
    expect(laPlanillaEncogio(2, 2157)).toBe(true);
  });

  it("una sola fila de menos ya alcanza", () => {
    // Cada sheets_row guardado es la promesa de que esa fila existe. Si falta
    // una, todas las de abajo se corrieron y ninguna escritura es segura.
    expect(laPlanillaEncogio(2162, 2163)).toBe(true);
  });

  it("las que esperabamos, o mas, estan bien", () => {
    expect(laPlanillaEncogio(2163, 2163)).toBe(false);
    expect(laPlanillaEncogio(2170, 2163)).toBe(false);
  });

  /** Sin nada anotado no hay con que comparar: no se bloquea. */
  it("sin referencia no opina", () => {
    expect(laPlanillaEncogio(0, 0)).toBe(false);
    expect(laPlanillaEncogio(2, 0)).toBe(false);
  });

  /** Una planilla nueva de verdad arranca vacia y tiene que poder recibir. */
  it("una pestana recien creada no es una que encogio", () => {
    expect(laPlanillaEncogio(1, 0)).toBe(false);
  });
});

describe("los tramos de una fila", () => {
  it("sin agujeros es un solo tramo", () => {
    expect(tramosDeLaFila(["a", "b", "c"])).toEqual([
      { desde: 0, hasta: 2, valores: ["a", "b", "c"] },
    ]);
  });

  /**
   * El caso de la planilla de OT: la columna L —indice 11— es una formula que
   * calcula atrasado/al dia y no se puede escribir ni con "".
   */
  it("un null en el medio parte la fila en dos", () => {
    const fila = [1, "x", null, "y", "z"];
    expect(tramosDeLaFila(fila)).toEqual([
      { desde: 0, hasta: 1, valores: [1, "x"] },
      { desde: 3, hasta: 4, valores: ["y", "z"] },
    ]);
  });

  it("varios agujeros dan varios tramos", () => {
    expect(tramosDeLaFila(["a", null, "b", null, "c"])).toEqual([
      { desde: 0, hasta: 0, valores: ["a"] },
      { desde: 2, hasta: 2, valores: ["b"] },
      { desde: 4, hasta: 4, valores: ["c"] },
    ]);
  });

  /** El vacio se escribe —es "sacá lo que habia"— y el null no. Son distintos. */
  it("el string vacio si se escribe", () => {
    expect(tramosDeLaFila(["a", "", "b"])).toEqual([
      { desde: 0, hasta: 2, valores: ["a", "", "b"] },
    ]);
  });

  it("un cero se escribe, que no es lo mismo que no tocar", () => {
    expect(tramosDeLaFila([0, null, 0])).toEqual([
      { desde: 0, hasta: 0, valores: [0] },
      { desde: 2, hasta: 2, valores: [0] },
    ]);
  });

  it("un null al principio y al final no deja tramos vacios", () => {
    expect(tramosDeLaFila([null, "a", null])).toEqual([
      { desde: 1, hasta: 1, valores: ["a"] },
    ]);
  });

  it("todo null no escribe nada", () => {
    expect(tramosDeLaFila([null, null])).toEqual([]);
    expect(tramosDeLaFila([])).toEqual([]);
  });
});

/**
 * Estaba sin tests. Es la cuenta de la que sale la fila donde se escribe, asi
 * que vale fijarla.
 */
describe("en que fila escribir, segun la columna que manda", () => {
  it("la siguiente a la ultima con algo", () => {
    expect(filaSiguienteSegunLaColumna([["N° OT"], ["622"], ["623"]])).toBe(4);
  });

  it("una fila vacia en el medio no corta la cuenta", () => {
    expect(filaSiguienteSegunLaColumna([["N° OT"], [], ["623"]])).toBe(4);
  });

  it("las vacias del final no cuentan", () => {
    expect(filaSiguienteSegunLaColumna([["N° OT"], ["622"], [""], ["  "]])).toBe(3);
  });

  /** Sin encabezado siquiera: la 1 queda para los titulos. */
  it("una pestana vacia empieza en la 2", () => {
    expect(filaSiguienteSegunLaColumna([])).toBe(2);
    expect(filaSiguienteSegunLaColumna([[""], []])).toBe(2);
  });
});
