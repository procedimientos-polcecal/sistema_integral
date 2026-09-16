import { describe, it, expect } from "vitest";
import { entraEnElSeguimiento } from "./seguimiento";

describe("entraEnElSeguimiento", () => {
  it("lo comprado entra", () => {
    expect(entraEnElSeguimiento("PEDIDO", false)).toBe(true);
    expect(entraEnElSeguimiento("RECIBIDO", false)).toBe(true);
  });

  /**
   * El caso que motivó la guarda: `exportarSeguimiento` se llama desde el PATCH
   * del requerimiento, por donde pasan aprobar, asignar y cargar un presupuesto.
   * Sin esto, cada una de esas acciones le creaba una fila en la planilla a un
   * RI que nadie compró todavía.
   */
  it("lo que todavía no se compró NO entra", () => {
    for (const estado of ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "DENEGADO", "EN_ESPERA", null]) {
      expect(entraEnElSeguimiento(estado, false)).toBe(false);
    }
  });

  /** Una fila que ya existe se sigue manteniendo: congelarla sería peor. */
  it("si ya tiene fila se sigue escribiendo, aunque haya vuelto atrás", () => {
    expect(entraEnElSeguimiento("EN_COMPARATIVA", true)).toBe(true);
  });
});
