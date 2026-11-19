import { describe, it, expect } from "vitest";
import {
  estaAtrasada, diasDeAtraso, ordenarPorAtraso, resumirAtrasadas,
  condicionDeAtrasada, ESTADOS_CERRADOS,
} from "./alertas";

const HOY = "2026-11-19";

describe("estaAtrasada", () => {
  it("la que arrancaba ayer y sigue abierta está atrasada", () => {
    expect(estaAtrasada({ estado: "POR_HACER", fecha_ejecucion: "2026-11-18" }, HOY)).toBe(true);
  });
  it("la que arranca hoy no está atrasada", () => {
    expect(estaAtrasada({ estado: "POR_HACER", fecha_ejecucion: HOY }, HOY)).toBe(false);
  });
  it("la que arrancó ayer pero termina mañana sigue en curso", () => {
    expect(estaAtrasada(
      { estado: "EN_PROCESO", fecha_ejecucion: "2026-11-18", fecha_fin: "2026-11-20" }, HOY
    )).toBe(false);
  });
  it("la que terminó ayer está atrasada", () => {
    expect(estaAtrasada(
      { estado: "EN_PROCESO", fecha_ejecucion: "2026-11-10", fecha_fin: "2026-11-18" }, HOY
    )).toBe(true);
  });
  it("una fecha_fin anterior al inicio vale «dura un día» y no adelanta el vencimiento", () => {
    expect(estaAtrasada(
      { estado: "POR_HACER", fecha_ejecucion: HOY, fecha_fin: "2026-11-01" }, HOY
    )).toBe(false);
  });
  it("la pendiente le gana a la de la planilla", () => {
    expect(estaAtrasada(
      { estado: "POR_HACER", fecha_ejecucion: "2026-11-01", fecha_ejecucion_pendiente: "2026-11-25" }, HOY
    )).toBe(false);
  });
  it("recorta la hora antes de comparar", () => {
    expect(estaAtrasada({ estado: "POR_HACER", fecha_ejecucion: "2026-11-18T00:00:00+00" }, HOY)).toBe(true);
    expect(estaAtrasada({ estado: "POR_HACER", fecha_ejecucion: `${HOY}T00:00:00+00` }, HOY)).toBe(false);
  });
  it("sin ninguna fecha no está atrasada", () => {
    expect(estaAtrasada({ estado: "POR_HACER" }, HOY)).toBe(false);
  });
  it("la que marcó la planilla está atrasada aunque no tenga fecha", () => {
    expect(estaAtrasada({ estado: "ATRASADO" }, HOY)).toBe(true);
  });
  it("una realizada o una cancelada nunca", () => {
    expect(estaAtrasada({ estado: "REALIZADO", fecha_ejecucion: "2026-01-01" }, HOY)).toBe(false);
    expect(estaAtrasada({ estado: "CANCELADA", fecha_ejecucion: "2026-01-01" }, HOY)).toBe(false);
  });
});

describe("diasDeAtraso", () => {
  it("cuenta contra el inicio efectivo", () => {
    expect(diasDeAtraso({ estado: "POR_HACER", fecha_ejecucion: "2026-11-13" }, HOY)).toBe(6);
  });
  it("es cero el mismo día", () => {
    expect(diasDeAtraso({ estado: "POR_HACER", fecha_ejecucion: HOY }, HOY)).toBe(0);
  });
  it("null cuando no hay ninguna fecha", () => {
    expect(diasDeAtraso({ estado: "ATRASADO" }, HOY)).toBeNull();
  });
  it("no se corre por la zona horaria", () => {
    expect(diasDeAtraso({ estado: "ATRASADO", fecha_ejecucion: "2026-11-18" }, HOY)).toBe(1);
  });
});

describe("condicionDeAtrasada", () => {
  it("nombra las dos columnas de inicio y protege la ventana", () => {
    const c = condicionDeAtrasada(HOY);
    expect(c).toContain("estado.eq.ATRASADO");
    expect(c).toContain(`fecha_ejecucion_pendiente.lt.${HOY}`);
    expect(c).toContain(`fecha_ejecucion.lt.${HOY}`);
    expect(c).toContain(`fecha_fin.lt.${HOY}`);
  });
  it("es exactamente la cadena verificada contra producción", () => {
    expect(condicionDeAtrasada(HOY)).toBe(
      "estado.eq.ATRASADO,and(fecha_ejecucion_pendiente.not.is.null,fecha_ejecucion_pendiente.lt.2026-11-19,or(fecha_fin.is.null,fecha_fin.lt.2026-11-19)),and(fecha_ejecucion_pendiente.is.null,fecha_ejecucion.lt.2026-11-19,or(fecha_fin.is.null,fecha_fin.lt.2026-11-19))"
    );
  });
});

describe("ESTADOS_CERRADOS", () => {
  it("son los dos en los que la orden no espera nada", () => {
    expect(ESTADOS_CERRADOS).toEqual(["REALIZADO", "CANCELADA"]);
  });
});

describe("ordenarPorAtraso", () => {
  it("pone primero la más atrasada", () => {
    const ordenadas = ordenarPorAtraso([
      { ot_number: 1, estado: "POR_HACER", fecha_ejecucion: "2026-08-20" },
      { ot_number: 2, estado: "POR_HACER", fecha_ejecucion: "2026-01-01" },
      { ot_number: 3, estado: "ATRASADO", fecha_ejecucion: null },
    ], HOY);

    expect(ordenadas.map((o) => o.ot_number)).toEqual([2, 1, 3]);
  });

  it("las que no dicen desde cuándo van al final", () => {
    // No se sabe qué tan urgentes son: primero lo que sí se puede medir.
    const ordenadas = ordenarPorAtraso([
      { ot_number: 1, estado: "ATRASADO", fecha_ejecucion: null },
      { ot_number: 2, estado: "POR_HACER", fecha_ejecucion: "2026-08-25" },
    ], HOY);
    expect(ordenadas[0].ot_number).toBe(2);
  });
});

describe("resumirAtrasadas", () => {
  const ordenes = [
    { ot_number: 1, estado: "POR_HACER", fecha_ejecucion: "2026-01-01", prioridad: "ALTA", sector_raw: "Calcinación" },
    { ot_number: 2, estado: "ATRASADO", fecha_ejecucion: "2026-08-20", prioridad: "MEDIA", sector_raw: "Calcinación" },
    { ot_number: 3, estado: "REALIZADO", fecha_ejecucion: "2026-01-01", prioridad: "ALTA", sector_raw: "Filler 2" },
  ];

  it("cuenta sólo las que están atrasadas de verdad", () => {
    expect(resumirAtrasadas(ordenes, HOY).total).toBe(2);
  });

  describe("urgentes", () => {
    const base = { estado: "POR_HACER", fecha_ejecucion: "2026-01-01", sector_raw: "Calcinación" };

    it("cuenta como urgentes las atrasadas de puntaje 65 o más", () => {
      const r = resumirAtrasadas([
        // 5 x 4 x 4 = 80
        { ...base, ot_number: 1, gut_gravedad: 5, gut_urgencia: 4, gut_tendencia: 4 },
        // 2 x 2 x 3 = 12
        { ...base, ot_number: 2, gut_gravedad: 2, gut_urgencia: 2, gut_tendencia: 3 },
      ], HOY);
      expect(r.urgentes).toBe(1);
    });

    it("no cuenta las que no tienen puntaje", () => {
      const r = resumirAtrasadas([
        { ...base, ot_number: 1 },
        { ...base, ot_number: 2, gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: null },
      ], HOY);
      expect(r.urgentes).toBe(0);
    });

    it("la prioridad de la planilla ya no cuenta", () => {
      // Una atrasada "🟠 Alta" sin GUT no es urgente. Antes tampoco lo era, pero
      // por un bug —la planilla guarda el emoji— y no por una decisión.
      const r = resumirAtrasadas([
        { ...base, ot_number: 1, prioridad: "🟠 Alta" },
        { ...base, ot_number: 2, prioridad: "ALTA" },
      ], HOY);
      expect(r.urgentes).toBe(0);
    });

    it("no cuenta una realizada aunque tenga GUT alto", () => {
      const r = resumirAtrasadas([
        { ...base, ot_number: 1, estado: "REALIZADO", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5 },
      ], HOY);
      expect(r.urgentes).toBe(0);
    });
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
