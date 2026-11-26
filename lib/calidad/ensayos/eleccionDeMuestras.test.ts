import { describe, expect, it } from "vitest";
import { laEleccionQueQueda, losTildesQueSiguen } from "./eleccionDeMuestras";

/**
 * El selector de muestras de la curva tilda varias de un producto y las aplica
 * de una. Lo que se prueba acá es lo único que no es dibujo: qué conjunto
 * queda cuando se aplica, que tiene dos trampas —las muestras de **otros**
 * productos no están en el selector y no se pueden perder, y el orden decide
 * el color de cada curva—.
 */
describe("laEleccionQueQueda", () => {
  it("agrega las tildadas al final, en el orden del producto", () => {
    expect(laEleccionQueQueda([], ["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
  });

  it("deja donde estaban las que ya estaban elegidas", () => {
    // "b" ya estaba primera y sigue tildada: no se mueve al final, porque
    // moverla le cambiaría el color a una curva que nadie tocó.
    expect(laEleccionQueQueda(["b"], ["a", "b", "c"], ["b", "a"])).toEqual(["b", "a"]);
  });

  it("saca las que se destildaron", () => {
    expect(laEleccionQueQueda(["a", "b"], ["a", "b", "c"], ["b"])).toEqual(["b"]);
  });

  it("no toca las muestras de otros productos", () => {
    // "x" es de otro producto: no está en el selector, así que destildar todo
    // no puede llevársela.
    expect(laEleccionQueQueda(["x", "a"], ["a", "b"], [])).toEqual(["x"]);
    expect(laEleccionQueQueda(["x", "a"], ["a", "b"], ["a", "b"])).toEqual(["x", "a", "b"]);
  });

  it("ignora un tildado que no es del producto", () => {
    expect(laEleccionQueQueda(["x"], ["a"], ["a", "z"])).toEqual(["x", "a"]);
  });

  it("no repite si algo llega dos veces", () => {
    expect(laEleccionQueQueda(["a"], ["a", "b"], ["a", "a", "b"])).toEqual(["a", "b"]);
  });
});

/**
 * Y lo que pasa cuando el selector cambia de alcance: el 26/11/2026 se le sumó
 * una casilla que agrega las muestras de los otros productos con el mismo juego
 * de tamices, así que lo visible crece y se achica sin que nadie tilde nada.
 */
describe("losTildesQueSiguen", () => {
  it("al ensanchar, lo que ya estaba elegido de lo nuevo entra tildado", () => {
    expect(losTildesQueSiguen(["a"], ["a", "b"], ["a", "b", "x", "y"], ["a", "x"])).toEqual([
      "a",
      "x",
    ]);
  });

  it("al ensanchar, lo que ya se veía conserva su tilde — y su destilde", () => {
    // "b" estaba elegida y la persona la destildó sin aplicar todavía: abrir el
    // grupo no puede devolvérsela.
    expect(losTildesQueSiguen(["a"], ["a", "b"], ["a", "b", "x"], ["a", "b"])).toEqual(["a"]);
  });

  it("al angostar, lo que deja de verse sale", () => {
    expect(losTildesQueSiguen(["a", "x"], ["a", "x"], ["a"], ["a", "x"])).toEqual(["a"]);
  });

  it("el orden es el de lo visible ahora", () => {
    expect(losTildesQueSiguen(["b", "a"], ["a", "b"], ["a", "b"], [])).toEqual(["a", "b"]);
  });
});
