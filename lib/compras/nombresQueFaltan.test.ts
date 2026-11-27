import { describe, expect, it } from "vitest";
import { claveProveedor, nombresQueFaltan } from "./sheets";

/** El padrón, para el helper: existe la clave o no existe. */
const padronCon = (...nombres: string[]) => {
  const claves = new Set(nombres.map(claveProveedor));
  return (clave: string) => claves.has(clave);
};

const vacio = () => false;

describe("qué nombres de la planilla hay que crear", () => {
  /*
   * El bug, tal cual pasó el 26/11/2026: dos formas de escribir el mismo
   * nombre entraban como dos filas en el mismo insert, porque la deduplicación
   * miraba el texto de la celda y no la clave.
   */
  it("dos formas del mismo nombre crean UNA sola ficha", () => {
    expect(nombresQueFaltan(["FERRETERIA MARFRA", "FERRETERÍA MARFRA"], vacio)).toEqual([
      "FERRETERIA MARFRA",
    ]);
  });

  it("y lo mismo con los otros tres pares que aparecieron ese día", () => {
    expect(nombresQueFaltan(["PINTURERIA ARCO IRIS", "PINTURERÍA ARCO IRIS"], vacio)).toHaveLength(1);
    expect(nombresQueFaltan(["OLAVARRIA GOMA", "OLAVARRÍA GOMA"], vacio)).toHaveLength(1);
    expect(nombresQueFaltan(["RM Seguridad ambiental", "RM SEGURIDAD AMBIENTAL"], vacio)).toHaveLength(1);
  });

  /** La clave también ignora mayúsculas, puntos, comillas y la forma social. */
  it("«Morc SRL» y «MORC» son el mismo", () => {
    expect(nombresQueFaltan(["Morc SRL", "MORC"], vacio)).toEqual(["Morc SRL"]);
  });

  it("se queda con la primera forma que aparece", () => {
    expect(nombresQueFaltan(["FERRETERÍA MARFRA", "FERRETERIA MARFRA"], vacio)).toEqual([
      "FERRETERÍA MARFRA",
    ]);
  });

  it("lo que ya está en el padrón no se crea, aunque venga escrito distinto", () => {
    expect(nombresQueFaltan(["FERRETERÍA MARFRA"], padronCon("Ferreteria Marfra"))).toEqual([]);
  });

  it("dos proveedores de verdad siguen siendo dos", () => {
    expect(nombresQueFaltan(["RANDAZZO", "FERRETERIA RANDAZZO"], vacio)).toHaveLength(2);
  });

  it("las celdas vacías y lo que no deja clave no entran", () => {
    expect(nombresQueFaltan(["", "   ", null, undefined, 0], vacio)).toEqual([]);
  });
});
