import { describe, expect, it } from "vitest";
import { estadoDe, loQueFalta, type CondicionParaFaltantes } from "./condicion";

const HOY = "2026-10-29";

const COMPLETA: CondicionParaFaltantes = {
  sector_id: "s1",
  equipo_id: "e1",
  responsable_id: "u1",
  fecha_maxima: "2026-11-15",
  frecuencia: 3,
  antecedentes: 2,
  controles: 3,
  magnitud_dano: 7,
  legislacion: 5,
};

describe("estadoDe", () => {
  it("con fecha de ejecución está cerrada, aunque la máxima haya pasado", () => {
    expect(estadoDe({ fecha_maxima: "2026-10-01", fecha_ejecucion: "2026-10-05" }, HOY)).toBe("Cerrada");
  });

  // El borde: todavía es hoy, así que no venció. Un `<` donde va `<=` vence todo
  // un día antes.
  it("la fecha máxima de hoy todavía no venció", () => {
    expect(estadoDe({ fecha_maxima: HOY, fecha_ejecucion: null }, HOY)).toBe("Pendiente");
    expect(estadoDe({ fecha_maxima: "2026-10-28", fecha_ejecucion: null }, HOY)).toBe("Vencida");
  });

  it("sin fecha máxima no puede vencer", () => {
    expect(estadoDe({ fecha_maxima: null, fecha_ejecucion: null }, HOY)).toBe("Pendiente");
  });
});

describe("loQueFalta", () => {
  it("una evaluación a medias sigue siendo sin evaluar", () => {
    const cuatroDeCinco = { ...COMPLETA, legislacion: null };
    expect(loQueFalta(cuatroDeCinco)).toContain("sin_evaluar");
  });

  it("sin responsable o sin fecha máxima está sin asignar", () => {
    expect(loQueFalta({ ...COMPLETA, responsable_id: null })).toContain("sin_asignar");
    expect(loQueFalta({ ...COMPLETA, fecha_maxima: null })).toContain("sin_asignar");
  });

  it("sin sector ni equipo está sin lugar; con uno de los dos, no", () => {
    expect(loQueFalta({ ...COMPLETA, sector_id: null, equipo_id: null })).toContain("sin_lugar");
    expect(loQueFalta({ ...COMPLETA, sector_id: null, equipo_id: "e1" })).not.toContain("sin_lugar");
  });

  it("una condición completa no tiene faltantes", () => {
    expect(loQueFalta(COMPLETA)).toEqual([]);
  });
});
