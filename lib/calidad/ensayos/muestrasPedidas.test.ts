import { describe, expect, it } from "vitest";
import { MUESTRAS_QUE_SE_ACEPTAN, leerMuestrasPedidas } from "./muestrasPedidas";

/** Tres uuid de verdad: desde que se lee por lote, la forma importa. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("leerMuestrasPedidas", () => {
  it("lee la lista nueva", () => {
    expect(leerMuestrasPedidas({ muestras: `${A},${B},${C}` })).toEqual([A, B, C]);
  });

  it("tira lo que no es un uuid y deja vivas a las otras", () => {
    // Las muestras se traen con UN `.in()`: un id mal formado hace que Postgres
    // rechace la consulta entera con 22P02, así que colarlo vaciaría la
    // pantalla en vez de saltear esa muestra. Y el disparador es el de todos
    // los días: un enlace compartido por chat al que le truncaron el último id
    // o le pegaron un paréntesis.
    expect(leerMuestrasPedidas({ muestras: `${A},no-soy-un-uuid,${B}` })).toEqual([A, B]);
    expect(leerMuestrasPedidas({ muestras: `${A}).` })).toEqual([]);
    expect(leerMuestrasPedidas({ muestras: A.slice(0, 20) })).toEqual([]);
  });

  it("el uuid no distingue mayusculas", () => {
    expect(leerMuestrasPedidas({ muestras: A.toUpperCase() })).toEqual([A.toUpperCase()]);
  });

  it("sigue aceptando el enlace viejo de una muestra", () => {
    expect(leerMuestrasPedidas({ muestra: A })).toEqual([A]);
  });

  it("junta las dos formas sin repetir", () => {
    expect(leerMuestrasPedidas({ muestra: A, muestras: `${B},${A}` })).toEqual([A, B]);
  });

  it("no repite dentro de la lista nueva", () => {
    expect(leerMuestrasPedidas({ muestras: `${A},${A},${B}` })).toEqual([A, B]);
  });

  it("ocho muestras entran enteras: comparar no tiene tope", () => {
    const ocho = Array.from({ length: 8 }, (_, i) => `${i}1111111-1111-4111-8111-111111111111`);
    expect(leerMuestrasPedidas({ muestras: ocho.join(",") })).toHaveLength(8);
  });

  it("pero corta en lo que entra en una consulta, que es el techo tecnico", () => {
    const ids = Array.from(
      { length: MUESTRAS_QUE_SE_ACEPTAN + 50 },
      (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`
    );
    expect(leerMuestrasPedidas({ muestras: ids.join(",") })).toHaveLength(MUESTRAS_QUE_SE_ACEPTAN);
  });

  it("el techo es el lote de un .in() de PostgREST", () => {
    expect(MUESTRAS_QUE_SE_ACEPTAN).toBe(200);
  });

  it("descarta los vacios y los espacios", () => {
    expect(leerMuestrasPedidas({ muestras: ` ${A} , ,${B} ` })).toEqual([A, B]);
  });

  it("un parametro repetido toma el primero", () => {
    expect(leerMuestrasPedidas({ muestras: [A, B] })).toEqual([A]);
  });

  it("sin nada, ninguna", () => {
    expect(leerMuestrasPedidas({})).toEqual([]);
    expect(leerMuestrasPedidas({ muestra: "", muestras: "" })).toEqual([]);
  });
});
