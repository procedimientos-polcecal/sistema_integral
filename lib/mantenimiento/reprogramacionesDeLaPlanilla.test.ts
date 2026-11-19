import { describe, it, expect } from "vitest";
import {
  lasQueHayQueRegistrar, CERRADAS_PARA_REPROGRAMAR, TOPE_DE_FILAS_POR_CORRIDA,
} from "@/lib/mantenimiento/reprogramacionesDeLaPlanilla";
import { CERRADAS_GUT } from "@/lib/mantenimiento/gut";
import type { OrdenDelSistema } from "@/lib/mantenimiento/contraste";
import type { OrdenLeida } from "@/lib/mantenimiento/ordenes";

/** Una orden del sistema, abierta y con fecha, salvo lo que se le cambie. */
function sistema(p: Partial<OrdenDelSistema> = {}): OrdenDelSistema {
  return {
    ot_number: 2969,
    sector_raw: null, equipo_raw: null, especialidad: null, tipo: null,
    quien: null, descripcion: null,
    fecha_ejecucion: "2026-11-20",
    fecha_cierre: null,
    estado: "POR_HACER",
    contratista: null, horas: null,
    operario_1: null, operario_2: null, operario_3: null, prioridad: null,
    sheets_pendiente: null,
    fecha_ejecucion_pendiente: null,
    ...p,
  };
}

/** La misma orden como la trae la planilla. */
function planilla(p: Partial<OrdenLeida> = {}): OrdenLeida {
  return {
    ot_number: 2969,
    fecha: null, sector_raw: null, equipo_raw: null, equipo_code: null,
    especialidad: null, tipo: null, quien: null, descripcion: null, repuesto: null,
    fecha_ejecucion: "2026-11-27",
    fecha_cierre: null,
    estado: "POR_HACER",
    estado_raw: "Por hacer",
    contratista: null, horas: null,
    operario_1: null, operario_2: null, operario_3: null, prioridad: null,
    frecuencia: null, proxima_fecha: null, sheets_row: 2,
    ...p,
  };
}

const SIN_HISTORIAL = new Map<number, string>();

describe("lasQueHayQueRegistrar", () => {
  it("registra una OT abierta cuya fecha de inicio cambió", () => {
    const r = lasQueHayQueRegistrar([sistema()], [planilla()], SIN_HISTORIAL);
    expect(r.freno).toBeNull();
    expect(r.filas).toEqual([
      { ot_number: 2969, fecha_anterior: "2026-11-20", fecha_nueva: "2026-11-27" },
    ]);
  });

  it("NO registra una OT cerrada (REALIZADO)", () => {
    const r = lasQueHayQueRegistrar(
      [sistema({ estado: "REALIZADO" })], [planilla()], SIN_HISTORIAL
    );
    expect(r.filas).toEqual([]);
  });

  /**
   * El segundo estado cerrado. Era `SUSPENDIDA` cuando se escribió el plan de
   * esta tarea; salió del vocabulario el 16/11/2026 y lo reemplazó `CANCELADA`.
   * Ver el encabezado del módulo: el test de abajo contra `CERRADAS_GUT` es lo
   * que ata los dos valores y fue lo que delató la diferencia.
   */
  it("NO registra una OT cerrada (CANCELADA)", () => {
    const r = lasQueHayQueRegistrar(
      [sistema({ estado: "CANCELADA" })], [planilla()], SIN_HISTORIAL
    );
    expect(r.filas).toEqual([]);
  });

  it("NO registra si la fecha no cambió", () => {
    const r = lasQueHayQueRegistrar(
      [sistema({ fecha_ejecucion: "2026-11-27" })], [planilla()], SIN_HISTORIAL
    );
    expect(r.filas).toEqual([]);
  });

  it("NO registra una OT con sheets_pendiente", () => {
    const r = lasQueHayQueRegistrar(
      [sistema({ sheets_pendiente: "Google dijo que no" })], [planilla()], SIN_HISTORIAL
    );
    expect(r.filas).toEqual([]);
  });

  it("NO registra una OT con fecha_ejecucion_pendiente", () => {
    const r = lasQueHayQueRegistrar(
      [sistema({ fecha_ejecucion_pendiente: "2026-12-01" })], [planilla()], SIN_HISTORIAL
    );
    expect(r.filas).toEqual([]);
  });

  it("NO registra si el sistema no tenía fecha y la planilla trae una", () => {
    const r = lasQueHayQueRegistrar(
      [sistema({ fecha_ejecucion: null })], [planilla()], SIN_HISTORIAL
    );
    expect(r.filas).toEqual([]);
  });

  /**
   * Lo contrario de lo que pedía el plan, y es a propósito: `fecha_nueva` es
   * `not null` en la tabla, así que una fecha que se vacía no tiene a dónde ir.
   * Y no hace falta registrarla: la orden sale sola de «necesitan
   * reprogramarse», que mira `fecha_ejecucion < hoy`.
   */
  it("NO registra si la planilla vacía la fecha", () => {
    const r = lasQueHayQueRegistrar(
      [sistema()], [planilla({ fecha_ejecucion: null })], SIN_HISTORIAL
    );
    expect(r.filas).toEqual([]);
  });

  it("NO registra si la OT no está en la planilla", () => {
    const r = lasQueHayQueRegistrar([sistema()], [], SIN_HISTORIAL);
    expect(r.filas).toEqual([]);
  });

  it("NO registra si la última fila del historial ya dice esa fecha nueva", () => {
    const r = lasQueHayQueRegistrar(
      [sistema()], [planilla()], new Map([[2969, "2026-11-27"]])
    );
    expect(r.filas).toEqual([]);
  });

  it("SÍ registra si vuelve a una fecha que tuvo antes, cuando la última dice otra", () => {
    const r = lasQueHayQueRegistrar(
      [sistema({ fecha_ejecucion: "2026-11-20" })],
      [planilla({ fecha_ejecucion: "2026-11-06" })],
      // Ya pasó por el 06/11 alguna vez, pero la última dice el 20/11.
      new Map([[2969, "2026-11-20"]])
    );
    expect(r.filas).toEqual([
      { ot_number: 2969, fecha_anterior: "2026-11-20", fecha_nueva: "2026-11-06" },
    ]);
  });

  it("corta y no devuelve ninguna fila si habría más que el tope, y dice por qué", () => {
    const cuantas = TOPE_DE_FILAS_POR_CORRIDA + 1;
    const delSistema = Array.from({ length: cuantas }, (_, i) =>
      sistema({ ot_number: 1000 + i })
    );
    const deLaPlanilla = Array.from({ length: cuantas }, (_, i) =>
      planilla({ ot_number: 1000 + i })
    );

    const r = lasQueHayQueRegistrar(delSistema, deLaPlanilla, SIN_HISTORIAL);
    expect(r.filas).toEqual([]);
    expect(r.freno).toContain(String(cuantas));
    expect(r.freno).toContain(String(TOPE_DE_FILAS_POR_CORRIDA));
  });

  /**
   * El levantamiento vive en la función pura y no en quien llama: si el filtro
   * devolviera las filas vacías y quien llama «levantara» el freno, no tendría
   * qué escribir. Es una llave distinta de la del borrado masivo, y el cron no
   * pasa ninguna de las dos.
   */
  it("con su propia llave escribe igual las que el freno habría tirado", () => {
    const cuantas = TOPE_DE_FILAS_POR_CORRIDA + 1;
    const delSistema = Array.from({ length: cuantas }, (_, i) =>
      sistema({ ot_number: 1000 + i })
    );
    const deLaPlanilla = Array.from({ length: cuantas }, (_, i) =>
      planilla({ ot_number: 1000 + i })
    );

    const r = lasQueHayQueRegistrar(delSistema, deLaPlanilla, SIN_HISTORIAL, { sinFreno: true });
    expect(r.freno).toBeNull();
    expect(r.filas).toHaveLength(cuantas);
  });

  it("justo en el tope no frena", () => {
    const delSistema = Array.from({ length: TOPE_DE_FILAS_POR_CORRIDA }, (_, i) =>
      sistema({ ot_number: 1000 + i })
    );
    const deLaPlanilla = Array.from({ length: TOPE_DE_FILAS_POR_CORRIDA }, (_, i) =>
      planilla({ ot_number: 1000 + i })
    );

    const r = lasQueHayQueRegistrar(delSistema, deLaPlanilla, SIN_HISTORIAL);
    expect(r.freno).toBeNull();
    expect(r.filas).toHaveLength(TOPE_DE_FILAS_POR_CORRIDA);
  });
});

describe("CERRADAS_PARA_REPROGRAMAR", () => {
  it("dice lo mismo que CERRADAS_GUT", () => {
    expect(CERRADAS_PARA_REPROGRAMAR).toEqual(CERRADAS_GUT);
  });
});
