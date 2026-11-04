import { describe, expect, it } from "vitest";
import { esCandidataAlCalendario } from "./candidata";

const HOY = "2026-11-04";

describe("que OT entra sola al calendario", () => {
  it("una con fecha futura y abierta entra", () => {
    const r = esCandidataAlCalendario({ fecha_ejecucion: "2026-11-06", estado: "POR_HACER" }, HOY);
    expect(r).toEqual({ ok: true, fecha: "2026-11-06" });
  });

  /**
   * Review Focus 1: cargada a las 15:00 con fecha de hoy, las 08:00 ya pasaron.
   * Entra igual — el filtro es por DIA y no por hora.
   */
  it("la de hoy entra aunque las 08:00 ya hayan pasado", () => {
    expect(esCandidataAlCalendario({ fecha_ejecucion: HOY, estado: "POR_HACER" }, HOY).ok).toBe(true);
  });

  it("una con fecha pasada no entra, y lo dice", () => {
    const r = esCandidataAlCalendario({ fecha_ejecucion: "2026-11-03", estado: "POR_HACER" }, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/pas/i);
  });

  it("una sin ninguna fecha no entra", () => {
    expect(esCandidataAlCalendario({ fecha_ejecucion: null, estado: "POR_HACER" }, HOY).ok).toBe(false);
  });

  /** `laOTEstaCerrada`: `fecha_cierre` O estado REALIZADO. 168 de 986 REALIZADO
      no tienen fecha de cierre, asi que las dos puntas cuentan. */
  it("una cerrada no entra por ninguna de las dos puntas", () => {
    expect(esCandidataAlCalendario({ fecha_ejecucion: "2026-11-06", fecha_cierre: "2026-11-01", estado: "POR_HACER" }, HOY).ok).toBe(false);
    expect(esCandidataAlCalendario({ fecha_ejecucion: "2026-11-06", estado: "REALIZADO" }, HOY).ok).toBe(false);
  });

  /** La pendiente gana: es la que `fechaParaElCalendario` prefiere y la que el
      derrame todavia no llevo al master. */
  it("manda la fecha pendiente cuando la hay", () => {
    const r = esCandidataAlCalendario(
      { fecha_ejecucion: "2026-11-06", fecha_ejecucion_pendiente: "2026-11-20", estado: "POR_HACER" }, HOY);
    expect(r).toEqual({ ok: true, fecha: "2026-11-20" });
  });

  /** Review Focus 2: la planilla puede mandar cualquier cosa. */
  it("una fecha mal formada no entra, y lo dice", () => {
    const r = esCandidataAlCalendario({ fecha_ejecucion: "06/11/2026", estado: "POR_HACER" }, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/fecha/i);
  });
});
