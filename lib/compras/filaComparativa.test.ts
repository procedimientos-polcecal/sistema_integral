import { describe, it, expect } from "vitest";
import { filaSiguienteSegunLaColumna } from "./drive";

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
    expect(filaSiguienteSegunLaColumna(col("N RI", "1865", "1865", "1870"))).toBe(5);
  });

  it("una planilla con solo el encabezado arranca en la 2", () => {
    expect(filaSiguienteSegunLaColumna(col("N RI"))).toBe(2);
  });

  it("una planilla vacia tambien arranca en la 2", () => {
    expect(filaSiguienteSegunLaColumna([])).toBe(2);
  });

  it("las filas vacias del final no cuentan", () => {
    // Esto es lo que rompia: la hoja se extiende con formato mucho mas abajo
    // que los datos, y append escribia ahi.
    expect(filaSiguienteSegunLaColumna(col("N RI", "1865", undefined, undefined))).toBe(3);
  });

  it("una fila vacia en el medio no corta la cuenta", () => {
    // Se busca la ultima con algo, no la primera sin nada: si no, un presupuesto
    // nuevo pisaria uno que ya estaba mas abajo.
    expect(filaSiguienteSegunLaColumna(col("N RI", "1865", undefined, "1870"))).toBe(5);
  });

  it("los espacios en blanco no son datos", () => {
    expect(filaSiguienteSegunLaColumna(col("N RI", "1865", "   "))).toBe(3);
  });
});

import { fechaCorta, enPesos, montoParaLaPlanilla } from "./comparativa";

/**
 * La planilla la lee gente. Lo que llegaba era
 * "2026-08-24T00:00:00+00:00", que es como lo guarda Postgres.
 */
describe("la fecha en la planilla", () => {
  it("va como la escribe una persona", () => {
    expect(fechaCorta("2026-08-24T00:00:00+00:00")).toBe("24/08/2026");
    expect(fechaCorta("2026-08-24")).toBe("24/08/2026");
  });

  it("no corre un dia por la zona horaria", () => {
    // Sin new Date(): a las 00:00 UTC, interpretar la zona local restaria un dia.
    expect(fechaCorta("2026-01-01T00:00:00+00:00")).toBe("01/01/2026");
  });

  it("sin fecha, celda vacia", () => {
    expect(fechaCorta(null)).toBe("");
    expect(fechaCorta(undefined)).toBe("");
  });

  it("lo que no reconoce lo deja pasar tal cual", () => {
    expect(fechaCorta("24 de agosto")).toBe("24 de agosto");
  });
});

/**
 * La planilla suma en pesos. Un unitario en dolares ahi es diez veces mas
 * chico que los demas y gana cualquier comparacion.
 */
describe("los montos en la planilla van en pesos", () => {
  it("en pesos no se toca nada", () => {
    expect(enPesos("ARS", 1200)).toBe(1);
    expect(enPesos(null, 1200)).toBe(1);
    expect(montoParaLaPlanilla(290, 1)).toBe("290");
  });

  it("en dolares se convierte con la cotizacion", () => {
    expect(enPesos("USD", 1200)).toBe(1200);
    expect(montoParaLaPlanilla(290, 1200)).toBe("348000");
  });

  it("sin cotizacion no se escribe: mejor vacio que el numero equivocado", () => {
    expect(enPesos("USD", null)).toBeNull();
    expect(enPesos("USD", 0)).toBeNull();
    expect(montoParaLaPlanilla(290, null)).toBe("");
  });

  it("un monto que no esta sigue sin estar", () => {
    expect(montoParaLaPlanilla(null, 1200)).toBe("");
  });

  it("redondea a centavos", () => {
    expect(montoParaLaPlanilla(10.005, 1)).toBe("10.01");
  });
});
