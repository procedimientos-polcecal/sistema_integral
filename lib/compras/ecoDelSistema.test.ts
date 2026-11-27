import { describe, it, expect } from "vitest";
import { esEcoDelSistema, esEcoAlReleer, ubicarLoDelSistema } from "./ecoDelSistema";

describe("esEcoDelSistema", () => {
  it("una fila con un id que el sistema conoce es su propio eco", () => {
    expect(esEcoDelSistema(["2301", "", "x"], 2, new Set(["x"]))).toBe(true);
  });
  it("una fila con un id desconocido no lo es: alguien la escribió afuera", () => {
    expect(esEcoDelSistema(["2301", "", "y"], 2, new Set(["x"]))).toBe(false);
  });
  it("sin columna de id ninguna fila es eco", () => {
    expect(esEcoDelSistema(["2301", ""], -1, new Set(["x"]))).toBe(false);
  });
  it("una celda vacía no es eco", () => {
    expect(esEcoDelSistema(["2301", "", ""], 2, new Set(["x"]))).toBe(false);
  });
});

describe("esEcoAlReleer", () => {
  const ids = new Set(["x"]);
  const filasApp = new Set([5, 6]);

  it("transición: sin columna de id, la fila cuyo número es de una cotización 'app' se saltea", () => {
    expect(esEcoAlReleer(["2301", ""], -1, ids, 5, filasApp)).toBe(true);
  });
  it("transición: con la columna pero la celda vacía, también", () => {
    expect(esEcoAlReleer(["2301", "", ""], 2, ids, 6, filasApp)).toBe(true);
  });
  it("sin id y con un número de fila que no es de 'app' entra como presupuesto", () => {
    expect(esEcoAlReleer(["2301", ""], -1, ids, 7, filasApp)).toBe(false);
  });
  it("con un id desconocido el número de fila no la salva: alguien la escribió afuera", () => {
    expect(esEcoAlReleer(["2301", "", "y"], 2, ids, 5, filasApp)).toBe(false);
  });
  it("con un id conocido es eco aunque el número de fila no coincida", () => {
    expect(esEcoAlReleer(["2301", "", "x"], 2, ids, 99, filasApp)).toBe(true);
  });
});

describe("ubicarLoDelSistema", () => {
  // La planilla: cada entrada es una fila con su número real en la hoja.
  const filas = (xs: [number, string][]) =>
    xs.map(([numeroFila, id]) => ({ fila: ["2301", "", id], numeroFila }));

  it("la fila que trae un id conocido dice dónde está esa cotización hoy", () => {
    const { correcciones } = ubicarLoDelSistema(
      filas([[153, "x"]]),
      2,
      [{ id: "x", drive_fila: 150 }]
    );
    expect(correcciones).toEqual([{ id: "x", drive_fila: 153 }]);
  });

  it("si la fila no se movió no hay nada que corregir", () => {
    const { correcciones } = ubicarLoDelSistema(
      filas([[150, "x"]]),
      2,
      [{ id: "x", drive_fila: 150 }]
    );
    expect(correcciones).toEqual([]);
  });

  it("una 'app' sin fila anotada la gana de la planilla", () => {
    const { correcciones } = ubicarLoDelSistema(
      filas([[88, "x"]]),
      2,
      [{ id: "x", drive_fila: null }]
    );
    expect(correcciones).toEqual([{ id: "x", drive_fila: 88 }]);
  });

  it("la cláusula (b) alcanza SÓLO a las 'app' que no tienen su id escrito", () => {
    // `x` tiene su id en la fila 153; `vieja` no aparece en la planilla.
    const { filasSinId } = ubicarLoDelSistema(
      filas([[153, "x"]]),
      2,
      [{ id: "x", drive_fila: 150 }, { id: "vieja", drive_fila: 19 }]
    );
    // 150 ya no está: ahí hoy puede haber el presupuesto de otro.
    expect([...filasSinId]).toEqual([19]);
  });

  it("sin columna de id, todas las 'app' con fila entran a la cláusula (b)", () => {
    const { filasSinId } = ubicarLoDelSistema(
      [{ fila: ["2301", ""], numeroFila: 19 }],
      -1,
      [{ id: "x", drive_fila: 19 }, { id: "y", drive_fila: 20 }]
    );
    expect([...filasSinId].sort((a, b) => a - b)).toEqual([19, 20]);
  });

  it("un id de la planilla que el sistema no conoce no ubica nada", () => {
    const { correcciones, filasSinId } = ubicarLoDelSistema(
      filas([[153, "ajeno"]]),
      2,
      [{ id: "x", drive_fila: 150 }]
    );
    expect(correcciones).toEqual([]);
    expect([...filasSinId]).toEqual([150]);
  });

  it("los ids son los de todas las 'app', tengan o no fila anotada", () => {
    const { idsDelSistema } = ubicarLoDelSistema(
      [],
      2,
      [{ id: "x", drive_fila: 150 }, { id: "y", drive_fila: null }]
    );
    expect([...idsDelSistema].sort()).toEqual(["x", "y"]);
  });
});
