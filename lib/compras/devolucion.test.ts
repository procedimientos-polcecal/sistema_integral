import { describe, it, expect } from "vitest";
import { esDevolucionAComparativa, faltaElMotivo } from "./devolucion";

/**
 * Devolver a comparativa le manda trabajo a otra persona, asi que no puede ser
 * mudo. Poner en espera, en cambio, es una decision que quien aprueba toma para
 * si mismo y no exige explicar nada.
 */
describe("devolver un pedido a comparativa", () => {
  it("volver de la bandeja a comparativa es una devolucion", () => {
    expect(esDevolucionAComparativa("PARA_COMPRAR", "EN_COMPARATIVA")).toBe(true);
  });

  it("llegar a comparativa desde otro lado no lo es", () => {
    // Al aprobar el requerimiento, SIN_INICIAR pasa a EN_COMPARATIVA solo: ahi
    // no hay nadie a quien explicarle nada.
    expect(esDevolucionAComparativa("SIN_INICIAR", "EN_COMPARATIVA")).toBe(false);
    expect(esDevolucionAComparativa("EN_ESPERA", "EN_COMPARATIVA")).toBe(false);
  });

  it("avanzar no es devolver", () => {
    expect(esDevolucionAComparativa("PARA_COMPRAR", "APROBADO")).toBe(false);
    expect(esDevolucionAComparativa("PARA_COMPRAR", "EN_ESPERA")).toBe(false);
  });
});

describe("el motivo de la devolucion", () => {
  it("sin motivo, la devolucion no pasa", () => {
    expect(faltaElMotivo("PARA_COMPRAR", "EN_COMPARATIVA", undefined)).toBe(true);
    expect(faltaElMotivo("PARA_COMPRAR", "EN_COMPARATIVA", null)).toBe(true);
    expect(faltaElMotivo("PARA_COMPRAR", "EN_COMPARATIVA", "")).toBe(true);
  });

  it("un motivo de puros espacios es no decir nada", () => {
    expect(faltaElMotivo("PARA_COMPRAR", "EN_COMPARATIVA", "   ")).toBe(true);
  });

  it("con motivo, pasa", () => {
    expect(
      faltaElMotivo("PARA_COMPRAR", "EN_COMPARATIVA", "Falta un tercer presupuesto")
    ).toBe(false);
  });

  it("los demas cambios de estado no piden motivo", () => {
    expect(faltaElMotivo("PARA_COMPRAR", "APROBADO", undefined)).toBe(false);
    expect(faltaElMotivo("PARA_COMPRAR", "EN_ESPERA", undefined)).toBe(false);
    expect(faltaElMotivo("SIN_INICIAR", "EN_COMPARATIVA", undefined)).toBe(false);
  });
});
