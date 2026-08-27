import { describe, it, expect } from "vitest";
import { estaAtrasada, diasDeAtraso, ordenarPorAtraso, resumirAtrasadas } from "./alertas";

const HOY = "2026-08-26";

describe("estaAtrasada", () => {
  it("lo está si la planilla la marcó atrasada", () => {
    expect(estaAtrasada({ estado: "ATRASADO", proxima_fecha: null }, HOY)).toBe(true);
  });

  it("lo está si venció su próxima fecha y no se hizo", () => {
    expect(estaAtrasada({ estado: "POR_HACER", proxima_fecha: "2026-08-01" }, HOY)).toBe(true);
    expect(estaAtrasada({ estado: "EN_PROCESO", proxima_fecha: "2026-08-25" }, HOY)).toBe(true);
  });

  it("no lo está si ya se hizo, aunque la fecha haya vencido", () => {
    // Una orden realizada tarde no es una orden atrasada: ya no hay nada que
    // hacer con ella.
    expect(estaAtrasada({ estado: "REALIZADO", proxima_fecha: "2026-01-01" }, HOY)).toBe(false);
  });

  it("no lo está si la fecha es hoy o futura", () => {
    expect(estaAtrasada({ estado: "POR_HACER", proxima_fecha: HOY }, HOY)).toBe(false);
    expect(estaAtrasada({ estado: "POR_HACER", proxima_fecha: "2026-09-10" }, HOY)).toBe(false);
  });

  it("no lo está sin fecha ni marca", () => {
    // Una orden por hacer sin fecha no está atrasada: nadie dijo para cuándo.
    expect(estaAtrasada({ estado: "POR_HACER", proxima_fecha: null }, HOY)).toBe(false);
  });

  it("una suspendida no está atrasada", () => {
    // Se paró a propósito: avisarlo todos los días es ruido.
    expect(estaAtrasada({ estado: "SUSPENDIDA", proxima_fecha: "2026-01-01" }, HOY)).toBe(false);
  });
});

describe("diasDeAtraso", () => {
  it("cuenta los días desde la fecha vencida", () => {
    expect(diasDeAtraso({ estado: "POR_HACER", proxima_fecha: "2026-08-20" }, HOY)).toBe(6);
  });

  it("es cero el mismo día", () => {
    expect(diasDeAtraso({ estado: "POR_HACER", proxima_fecha: HOY }, HOY)).toBe(0);
  });

  it("no cuenta los días de una marcada a mano sin fecha", () => {
    // La planilla la marcó atrasada pero no dice desde cuándo.
    expect(diasDeAtraso({ estado: "ATRASADO", proxima_fecha: null }, HOY)).toBeNull();
  });

  it("no se corre por la zona horaria", () => {
    // Con `new Date(fecha)` el día se corre en un servidor en UTC.
    expect(diasDeAtraso({ estado: "ATRASADO", proxima_fecha: "2026-08-25" }, HOY)).toBe(1);
  });
});

describe("ordenarPorAtraso", () => {
  it("pone primero la más atrasada", () => {
    const ordenadas = ordenarPorAtraso([
      { ot_number: 1, estado: "POR_HACER", proxima_fecha: "2026-08-20" },
      { ot_number: 2, estado: "POR_HACER", proxima_fecha: "2026-01-01" },
      { ot_number: 3, estado: "ATRASADO", proxima_fecha: null },
    ], HOY);

    expect(ordenadas.map((o) => o.ot_number)).toEqual([2, 1, 3]);
  });

  it("las que no dicen desde cuándo van al final", () => {
    // No se sabe qué tan urgentes son: primero lo que sí se puede medir.
    const ordenadas = ordenarPorAtraso([
      { ot_number: 1, estado: "ATRASADO", proxima_fecha: null },
      { ot_number: 2, estado: "POR_HACER", proxima_fecha: "2026-08-25" },
    ], HOY);
    expect(ordenadas[0].ot_number).toBe(2);
  });
});

describe("resumirAtrasadas", () => {
  const ordenes = [
    { ot_number: 1, estado: "POR_HACER", proxima_fecha: "2026-01-01", prioridad: "ALTA", sector_raw: "Calcinación" },
    { ot_number: 2, estado: "ATRASADO", proxima_fecha: "2026-08-20", prioridad: "MEDIA", sector_raw: "Calcinación" },
    { ot_number: 3, estado: "REALIZADO", proxima_fecha: "2026-01-01", prioridad: "ALTA", sector_raw: "Filler 2" },
  ];

  it("cuenta sólo las que están atrasadas de verdad", () => {
    expect(resumirAtrasadas(ordenes, HOY).total).toBe(2);
  });

  it("dice cuántas son urgentes", () => {
    expect(resumirAtrasadas(ordenes, HOY).urgentes).toBe(1);
  });

  it("dice cuál es la más vieja", () => {
    expect(resumirAtrasadas(ordenes, HOY).masVieja?.ot_number).toBe(1);
  });

  it("agrupa por sector, de mayor a menor", () => {
    expect(resumirAtrasadas(ordenes, HOY).porSector).toEqual([
      { sector: "Calcinación", cuantas: 2 },
    ]);
  });

  it("no se rompe sin ninguna atrasada", () => {
    const r = resumirAtrasadas([ordenes[2]], HOY);
    expect(r.total).toBe(0);
    expect(r.masVieja).toBeNull();
  });
});
