import { describe, it, expect } from "vitest";
import { lecturaDeMontoAlto, POSICIONES_DE_MONTO_ALTO } from "./montoAltoPantalla";

const UMBRAL = 1_500_000;

/**
 * Cada caso tiene que decir **cuál de los dos mandó**. El que no se puede
 * dejar callado es el de 29 millones desmarcado a mano: parece un error.
 */
describe("lo que la ficha dice del monto alto", () => {
  it("un monto que pasa el umbral, sin que nadie opine, es alto por el monto", () => {
    const l = lecturaDeMontoAlto(2_000_000, null, UMBRAL);
    expect(l).toMatchObject({ alto: true, titulo: "Monto alto", porque: "por el monto", esManual: false });
  });

  it("el umbral justo ya es alto", () => {
    expect(lecturaDeMontoAlto(UMBRAL, null, UMBRAL).alto).toBe(true);
  });

  it("un monto de 29 millones desmarcado dice que lo desmarco una persona", () => {
    const l = lecturaDeMontoAlto(29_000_000, false, UMBRAL);
    expect(l).toMatchObject({
      alto: false,
      titulo: "No es monto alto",
      porque: "una persona lo desmarcó",
      esManual: true,
    });
  });

  it("uno marcado a mano sin ningun monto es alto porque lo marco una persona", () => {
    const l = lecturaDeMontoAlto(null, true, UMBRAL);
    expect(l).toMatchObject({ alto: true, porque: "lo marcó una persona", esManual: true });
  });

  it("desmarcado a mano con un monto chico sigue diciendo que fue una persona", () => {
    const l = lecturaDeMontoAlto(50_000, false, UMBRAL);
    expect(l).toMatchObject({ alto: false, porque: "una persona lo desmarcó", esManual: true });
  });

  it("sin monto y sin marca, dice que todavia no hay monto", () => {
    const l = lecturaDeMontoAlto(null, null, UMBRAL);
    expect(l).toMatchObject({ alto: false, porque: "todavía no hay ningún monto", esManual: false });
  });

  it("un monto por debajo del umbral dice que no llega", () => {
    const l = lecturaDeMontoAlto(75_000, null, UMBRAL);
    expect(l).toMatchObject({ alto: false, porque: "el monto no llega al umbral", esManual: false });
  });
});

describe("las tres posiciones del control", () => {
  it("son automatico, es alto y no es alto, y mandan null, true y false", () => {
    expect(POSICIONES_DE_MONTO_ALTO.map((p) => p.valor)).toEqual([null, true, false]);
    expect(POSICIONES_DE_MONTO_ALTO.map((p) => p.texto)).toEqual(["Automático", "Es alto", "No es alto"]);
  });
});
