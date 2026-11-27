import { describe, it, expect } from "vitest";
import { rangoDelBloque } from "./bloqueDeFilas";

describe("el rango de un bloque de filas", () => {
  it("abarca de la primera a la última fila y hasta la columna más ancha", () => {
    expect(rangoDelBloque("Hoja 1", 10, [["a", "b"], ["c", "d", "e"]]))
      .toBe("Hoja 1!A10:C11");
  });
  it("una sola fila da un rango de una sola fila", () => {
    expect(rangoDelBloque("Hoja 1", 7, [["a"]])).toBe("Hoja 1!A7:A7");
  });
  // El rango tiene que cubrir TODAS las columnas que se mandan: si queda
  // corto, Google rechaza la escritura entera.
  it("se mide por la fila más ancha y no por la primera", () => {
    expect(rangoDelBloque("Hoja 1", 1, [["a"], ["b", "c", "d"]])).toBe("Hoja 1!A1:C2");
  });
  it("un bloque vacío no tiene rango", () => {
    expect(() => rangoDelBloque("Hoja 1", 1, [])).toThrow();
  });
});
