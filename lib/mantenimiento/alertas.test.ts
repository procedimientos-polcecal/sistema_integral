import { describe, it, expect } from "vitest";
import {
  estaAtrasada, diasDeAtraso, ordenarPorAtraso, resumirAtrasadas, resumirLaSemana,
  DIAS_DE_LA_SEMANA,
} from "./alertas";

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

  it("una cancelada no está atrasada", () => {
    // No se va a hacer nunca: avisarlo todos los días es ruido.
    expect(estaAtrasada({ estado: "CANCELADA", proxima_fecha: "2026-01-01" }, HOY)).toBe(false);
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

  describe("urgentes", () => {
    const base = { estado: "POR_HACER", proxima_fecha: "2026-01-01", sector_raw: "Calcinación" };

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

describe("diasDeAtraso con fecha_ejecucion", () => {
  it("cae en fecha_ejecucion cuando no hay proxima_fecha", () => {
    // Las 61 OT abiertas de produccion no tienen `proxima_fecha`: sin esto,
    // las 19 atrasadas muestran un guion y el panel no las ordena.
    expect(diasDeAtraso(
      { estado: "ATRASADO", proxima_fecha: null, fecha_ejecucion: "2026-08-20" }, HOY
    )).toBe(6);
  });

  it("proxima_fecha manda cuando estan las dos", () => {
    // El vencimiento que puso una persona gana sobre el dia previsto.
    expect(diasDeAtraso(
      { estado: "ATRASADO", proxima_fecha: "2026-08-25", fecha_ejecucion: "2026-01-01" }, HOY
    )).toBe(1);
  });

  it("sigue devolviendo null sin ninguna de las dos", () => {
    expect(diasDeAtraso({ estado: "ATRASADO", proxima_fecha: null }, HOY)).toBeNull();
  });
});

describe("resumirLaSemana", () => {
  const dela = (p: Record<string, unknown>) => ({
    ot_number: 1, estado: "ATRASADO", proxima_fecha: null,
    sector_id: "s1", sector_raw: "Calcinacion",
    equipment_id: "e1", equipo_raw: "PO-B1-02", ...p,
  });

  it("la ventana son siete dias contando hoy", () => {
    expect(DIAS_DE_LA_SEMANA).toBe(7);
    expect(resumirLaSemana([], HOY).desde).toBe("2026-08-20");
  });

  it("entra la que vencia hoy", () => {
    // Ya esta marcada atrasada: es de esta semana.
    expect(resumirLaSemana([dela({ fecha_ejecucion: HOY })], HOY).total).toBe(1);
  });

  it("entra la del septimo dia hacia atras y no la del octavo", () => {
    const r = resumirLaSemana([
      dela({ ot_number: 1, fecha_ejecucion: "2026-08-20" }),
      dela({ ot_number: 2, fecha_ejecucion: "2026-08-19" }),
    ], HOY);
    expect(r.ordenes.map((o) => o.ot_number)).toEqual([1]);
  });

  it("no entra una con fecha_ejecucion futura", () => {
    // Hay errores de carga con el ano mal tipeado.
    expect(resumirLaSemana([dela({ fecha_ejecucion: "2027-08-21" })], HOY).total).toBe(0);
  });

  it("no entra una realizada ni una cancelada", () => {
    const r = resumirLaSemana([
      dela({ ot_number: 1, estado: "REALIZADO", fecha_ejecucion: "2026-08-21" }),
      dela({ ot_number: 2, estado: "CANCELADA", fecha_ejecucion: "2026-08-21" }),
    ], HOY);
    expect(r.total).toBe(0);
  });

  it("agrupa por equipo, con id cuando lo hay", () => {
    const r = resumirLaSemana([
      dela({ ot_number: 1, equipment_id: "e1", equipo_raw: "Tolva", fecha_ejecucion: "2026-08-21" }),
      dela({ ot_number: 2, equipment_id: "e1", equipo_raw: "Tolva", fecha_ejecucion: "2026-08-22" }),
      dela({ ot_number: 3, equipment_id: "e2", equipo_raw: "Cinta", fecha_ejecucion: "2026-08-23" }),
    ], HOY);
    expect(r.porEquipo).toEqual([
      { clave: "e1", nombre: "Tolva", id: "e1", cuantas: 2 },
      { clave: "e2", nombre: "Cinta", id: "e2", cuantas: 1 },
    ]);
  });

  it("un equipo sin id se nombra por su texto y no se puede enlazar", () => {
    const r = resumirLaSemana([
      dela({ equipment_id: null, equipo_raw: "Sala de balanza", fecha_ejecucion: "2026-08-21" }),
    ], HOY);
    expect(r.porEquipo).toEqual([
      { clave: "Sala de balanza", nombre: "Sala de balanza", id: null, cuantas: 1 },
    ]);
  });

  it("agrupa por sector, de mayor a menor", () => {
    const r = resumirLaSemana([
      dela({ ot_number: 1, sector_id: "s1", sector_raw: "Calcinacion", fecha_ejecucion: "2026-08-21" }),
      dela({ ot_number: 2, sector_id: "s2", sector_raw: "Hidratacion", fecha_ejecucion: "2026-08-22" }),
      dela({ ot_number: 3, sector_id: "s2", sector_raw: "Hidratacion", fecha_ejecucion: "2026-08-23" }),
    ], HOY);
    expect(r.porSector.map((s) => [s.nombre, s.cuantas])).toEqual([
      ["Hidratacion", 2], ["Calcinacion", 1],
    ]);
  });

  it("deTodas cuenta las atrasadas y total las de la semana", () => {
    const r = resumirLaSemana([
      dela({ ot_number: 1, fecha_ejecucion: "2026-08-21" }),
      dela({ ot_number: 2, fecha_ejecucion: "2026-01-15" }),
      dela({ ot_number: 3, estado: "REALIZADO", fecha_ejecucion: "2026-08-21" }),
    ], HOY);
    expect(r.total).toBe(1);
    expect(r.deTodas).toBe(2);
  });

  it("una atrasada sin fecha_ejecucion no es de esta semana", () => {
    // Que no se sepa cuando vencia no la vuelve reciente.
    const r = resumirLaSemana([dela({ fecha_ejecucion: null })], HOY);
    expect(r.total).toBe(0);
    expect(r.deTodas).toBe(1);
  });
});
