import { describe, it, expect } from "vitest";
import { esFilaPlantilla, RI_PLANTILLA } from "./constants";

/**
 * La fila 2 del master no es un requerimiento: es la plantilla con las
 * formulas que la planilla arrastra al resto. Tiene numero de RI, asi que el
 * importador la levantaba como una fila mas; despues alguien la aprobo desde
 * la app y quedo encolada una escritura sobre esas formulas.
 */
describe("la fila plantilla de la planilla", () => {
  it("es el RI 1, y ninguno mas", () => {
    expect(esFilaPlantilla(RI_PLANTILLA)).toBe(true);
    expect(esFilaPlantilla(1)).toBe(true);
  });

  it("no se lleva puesto al RI 2, que es real", () => {
    // "Terminales LCT B5". La serie de verdad arranca ahi, y por eso el riesgo
    // de reconocerla por el numero es aceptable: no hay un RI 1 legitimo.
    expect(esFilaPlantilla(2)).toBe(false);
    expect(esFilaPlantilla(1860)).toBe(false);
  });

  it("un numero que no existe tampoco es la plantilla", () => {
    expect(esFilaPlantilla(0)).toBe(false);
    expect(esFilaPlantilla(-1)).toBe(false);
  });
});
