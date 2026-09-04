import { describe, it, expect } from "vitest";
import { justificacionQueExplica } from "./justificacion";

/**
 * Que un texto sea obligatorio no alcanza: un punto satisface a un `.trim()` y
 * no explica nada. Lo que se filtra no es la longitud sino la no-respuesta.
 */
describe("un texto que explica algo", () => {
  it("acepta un motivo corto pero real", () => {
    // "Duplicado" tiene 9 letras y es un motivo completo: un minimo generoso lo
    // rechazaria, y por eso el minimo es 4 y no 10.
    expect(justificacionQueExplica("Duplicado")).toBe(true);
    expect(justificacionQueExplica("No hay presupuesto este mes")).toBe(true);
    expect(justificacionQueExplica("Se resuelve con lo que hay en el panol")).toBe(true);
  });

  it("no acepta el vacio ni los espacios", () => {
    expect(justificacionQueExplica("")).toBe(false);
    expect(justificacionQueExplica("   ")).toBe(false);
    expect(justificacionQueExplica(null)).toBe(false);
    expect(justificacionQueExplica(undefined)).toBe(false);
  });

  it("no acepta la puntuacion sola", () => {
    // Lo que se escribe para pasar la validacion sin decir nada.
    expect(justificacionQueExplica(".")).toBe(false);
    expect(justificacionQueExplica("-")).toBe(false);
    expect(justificacionQueExplica("...")).toBe(false);
    expect(justificacionQueExplica("1234")).toBe(false);
  });

  it("no acepta las no-respuestas conocidas", () => {
    expect(justificacionQueExplica("no")).toBe(false);
    expect(justificacionQueExplica("NO")).toBe(false);
    expect(justificacionQueExplica("n/a")).toBe(false);
    expect(justificacionQueExplica("nada")).toBe(false);
    expect(justificacionQueExplica("ninguno")).toBe(false);
    expect(justificacionQueExplica("sin motivo")).toBe(false);
    expect(justificacionQueExplica("x")).toBe(false);
  });

  it("la no-respuesta se reconoce con acentos y espacios de mas", () => {
    // Se compara normalizado por la misma razon que el resto del sistema: la
    // misma palabra escrita de dos formas es la misma palabra.
    expect(justificacionQueExplica("  Sin  Motivo  ")).toBe(false);
    expect(justificacionQueExplica("ningún")).toBe(false);
  });

  it("una no-respuesta que ademas explica, pasa", () => {
    // "no" solo no dice nada; "no corresponde al area" si.
    expect(justificacionQueExplica("No corresponde al area")).toBe(true);
    expect(justificacionQueExplica("Sin motivo tecnico, lo pidio dos veces")).toBe(true);
  });
});
