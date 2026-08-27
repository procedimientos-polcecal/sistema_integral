import { describe, it, expect } from "vitest";
import { filaSiguienteSegunColumnaA } from "./drive";

const col = (...valores: (string | undefined)[]) => valores.map((v) => (v === undefined ? [] : [v]));

/**
 * Donde va un presupuesto nuevo en la planilla de comparativa.
 *
 * Antes se usaba `append` de Google, que salta despues de cualquier contenido
 * de la hoja —formato, formulas, desplegables— y no solo despues de los datos.
 * En "ESPIRA SINFIN" eso mando dos presupuestos a las filas 1003 y 1004, mil
 * filas mas abajo de donde se los podia ver.
 */
describe("en que fila va el presupuesto nuevo", () => {
  it("despues de la ultima fila con datos", () => {
    // Encabezado + 3 presupuestos = la proxima es la 5.
    expect(filaSiguienteSegunColumnaA(col("N RI", "1865", "1865", "1870"))).toBe(5);
  });

  it("una planilla con solo el encabezado arranca en la 2", () => {
    expect(filaSiguienteSegunColumnaA(col("N RI"))).toBe(2);
  });

  it("una planilla vacia tambien arranca en la 2", () => {
    expect(filaSiguienteSegunColumnaA([])).toBe(2);
  });

  it("las filas vacias del final no cuentan", () => {
    // Esto es lo que rompia: la hoja se extiende con formato mucho mas abajo
    // que los datos, y append escribia ahi.
    expect(filaSiguienteSegunColumnaA(col("N RI", "1865", undefined, undefined))).toBe(3);
  });

  it("una fila vacia en el medio no corta la cuenta", () => {
    // Se busca la ultima con algo, no la primera sin nada: si no, un presupuesto
    // nuevo pisaria uno que ya estaba mas abajo.
    expect(filaSiguienteSegunColumnaA(col("N RI", "1865", undefined, "1870"))).toBe(5);
  });

  it("los espacios en blanco no son datos", () => {
    expect(filaSiguienteSegunColumnaA(col("N RI", "1865", "   "))).toBe(3);
  });
});
