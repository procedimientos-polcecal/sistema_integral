import { describe, it, expect } from "vitest";
import { DIAS_DE_LA_VENTANA, rangoDeLaVentana } from "./odoo";

/**
 * El rango que se le pide a Odoo. Es lo único puro de `odoo.ts`, y es donde
 * viven dos corrimientos que si se equivocan **no fallan**: devuelven la lista
 * de otro día, y el encargado carga la orden sin remito sin saber por qué.
 */
describe("rangoDeLaVentana", () => {
  it("arranca a las 03:00 UTC, que es la medianoche de Argentina", () => {
    const { desde } = rangoDeLaVentana("2026-09-09", 1);
    expect(desde).toBe("2026-09-09 03:00:00");
  });

  it("termina cubriendo el día siguiente, para el remito emitido por adelantado", () => {
    const { hasta } = rangoDeLaVentana("2026-09-09", 1);
    // 11/09 02:59 UTC es el final del 10/09 en Argentina.
    expect(hasta).toBe("2026-09-11 02:59:59");
  });

  it("los días cuentan hacia atrás incluyendo el de hoy", () => {
    expect(rangoDeLaVentana("2026-09-09", 7).desde).toBe("2026-09-03 03:00:00");
    expect(rangoDeLaVentana("2026-09-09", 3).desde).toBe("2026-09-07 03:00:00");
  });

  it("cruza el mes y el año sin ayuda", () => {
    expect(rangoDeLaVentana("2026-03-03", 7).desde).toBe("2026-02-25 03:00:00");
    expect(rangoDeLaVentana("2027-01-02", 7).desde).toBe("2026-12-27 03:00:00");
    expect(rangoDeLaVentana("2026-12-31", 1).hasta).toBe("2027-01-02 02:59:59");
  });

  /**
   * Siete y no uno: 131 de 1.383 remitos tienen `scheduled_date` de un día
   * distinto al de su creación, así que un día esconde uno de cada diez.
   */
  it("la ventana por defecto es de una semana", () => {
    expect(DIAS_DE_LA_VENTANA).toBe(7);
    expect(rangoDeLaVentana("2026-09-09")).toEqual(rangoDeLaVentana("2026-09-09", 7));
  });
});
