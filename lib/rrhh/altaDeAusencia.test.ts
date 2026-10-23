import { describe, it, expect } from "vitest";
import { periodoEstaCerrado, TIPOS_DEL_ENCARGADO } from "./altaDeAusencia";

describe("periodoEstaCerrado", () => {
  // Mover una liquidacion ya cerrada no se deshace
  it("una fecha dentro de una liquidacion cerrada esta cerrada", () => {
    const liq = [{ fecha_desde: "2026-09-01", fecha_hasta: "2026-09-30", estado: "CERRADA" }];
    expect(periodoEstaCerrado(liq, "2026-09-15")).toBe(true);
    expect(periodoEstaCerrado(liq, "2026-09-01")).toBe(true);
    expect(periodoEstaCerrado(liq, "2026-09-30")).toBe(true);
    expect(periodoEstaCerrado(liq, "2026-10-01")).toBe(false);
  });

  it("una liquidacion en borrador no cierra nada", () => {
    const liq = [{ fecha_desde: "2026-09-01", fecha_hasta: "2026-09-30", estado: "BORRADOR" }];
    expect(periodoEstaCerrado(liq, "2026-09-15")).toBe(false);
  });

  /**
   * Un empleado tiene una liquidación por período, así que la lista trae varias
   * y basta con que la cerrada sea la que contiene la fecha. Si se mirara sólo
   * la primera, un mes cerrado viejo dejaría de frenar nada.
   */
  it("alcanza con que la cerrada sea la que contiene la fecha", () => {
    const liq = [
      { fecha_desde: "2026-08-01", fecha_hasta: "2026-08-31", estado: "BORRADOR" },
      { fecha_desde: "2026-09-01", fecha_hasta: "2026-09-30", estado: "CERRADA" },
    ];
    expect(periodoEstaCerrado(liq, "2026-09-15")).toBe(true);
    expect(periodoEstaCerrado(liq, "2026-08-15")).toBe(false);
  });

  it("sin liquidaciones no hay nada cerrado", () => {
    expect(periodoEstaCerrado([], "2026-09-15")).toBe(false);
  });
});

describe("TIPOS_DEL_ENCARGADO", () => {
  it("el encargado no puede elegir vacaciones ni ART", () => {
    expect(TIPOS_DEL_ENCARGADO).toEqual(
      ["PERMISO_PERSONAL", "ENFERMEDAD_ACCIDENTE_INCULPABLE", "INJUSTIFICADA", "OTRA"]
    );
  });
});
