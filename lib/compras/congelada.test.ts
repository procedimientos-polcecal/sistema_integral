import { describe, it, expect } from "vitest";
import { comparativaCongelada, ESTADOS_DECIDIDOS } from "./congelada";

const sinDecidir = { proveedorId: null, hayPresupuestoElegido: false };

describe("cuándo se congela la comparativa", () => {
  it("en las etapas previas nunca", () => {
    for (const estado of ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "EN_ESPERA"]) {
      expect(comparativaCongelada({ estadoCompra: estado, ...sinDecidir }), estado).toBe(false);
    }
  });

  it("con un presupuesto elegido, sí", () => {
    for (const estado of ESTADOS_DECIDIDOS) {
      expect(
        comparativaCongelada({ estadoCompra: estado, proveedorId: null, hayPresupuestoElegido: true }),
        estado
      ).toBe(true);
    }
  });

  it("con proveedor en el requerimiento, sí", () => {
    // Los 1.675 RI históricos vinieron de la planilla con proveedor y costo, sin
    // pasar por una comparativa: ésos están decididos igual.
    expect(
      comparativaCongelada({
        estadoCompra: "APROBADO",
        proveedorId: "uuid-casa-camino",
        hayPresupuestoElegido: false,
      })
    ).toBe(true);
  });

  /*
   * El caso de los 35: el estado dice APROBADO y no hay nada decidido, porque el
   * estado vino de la columna de la planilla. No hay decisión que proteger, así
   * que no se congela: si se congelara, no habría forma de resolverlo.
   */
  it("si el estado dice decidida y no hay nada decidido, NO se congela", () => {
    expect(comparativaCongelada({ estadoCompra: "APROBADO", ...sinDecidir })).toBe(false);
    expect(comparativaCongelada({ estadoCompra: "PEDIDO", ...sinDecidir })).toBe(false);
    expect(comparativaCongelada({ estadoCompra: "RECIBIDO", ...sinDecidir })).toBe(false);
  });

  it("un estado desconocido no congela nada", () => {
    // Si mañana aparece un estado nuevo, el default es dejar trabajar.
    expect(comparativaCongelada({ estadoCompra: "LO_QUE_SEA", ...sinDecidir })).toBe(false);
  });
});
