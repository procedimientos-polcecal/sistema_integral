import { describe, expect, it } from "vitest";
import { TOPE_DE_MUESTRAS } from "./comparacion";
import { leerMuestrasPedidas } from "./muestrasPedidas";

describe("leerMuestrasPedidas", () => {
  it("lee la lista nueva", () => {
    expect(leerMuestrasPedidas({ muestras: "a,b,c" })).toEqual(["a", "b", "c"]);
  });

  it("sigue aceptando el enlace viejo de una muestra", () => {
    expect(leerMuestrasPedidas({ muestra: "a" })).toEqual(["a"]);
  });

  it("junta las dos formas sin repetir", () => {
    expect(leerMuestrasPedidas({ muestra: "a", muestras: "b,a" })).toEqual(["a", "b"]);
  });

  it("no repite dentro de la lista nueva", () => {
    expect(leerMuestrasPedidas({ muestras: "a,a,b" })).toEqual(["a", "b"]);
  });

  it("no se pasa del tope", () => {
    expect(leerMuestrasPedidas({ muestras: "a,b,c,d,e,f,g,h" })).toHaveLength(TOPE_DE_MUESTRAS);
  });

  it("descarta los vacios y los espacios", () => {
    expect(leerMuestrasPedidas({ muestras: " a , ,b " })).toEqual(["a", "b"]);
  });

  it("un parametro repetido toma el primero", () => {
    expect(leerMuestrasPedidas({ muestras: ["a", "b"] })).toEqual(["a"]);
  });

  it("sin nada, ninguna", () => {
    expect(leerMuestrasPedidas({})).toEqual([]);
    expect(leerMuestrasPedidas({ muestra: "", muestras: "" })).toEqual([]);
  });
});
