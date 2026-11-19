import { describe, it, expect } from "vitest";
import {
  lasQueHayQueRegistrar, laUltimaPorOt,
  CERRADAS_PARA_REPROGRAMAR, TOPE_DE_FILAS_POR_CORRIDA,
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
   * El mensaje no puede prometer que repitiendo la llamada vuelven, porque no
   * vuelven: esta función corre ANTES del upsert y el upsert de la misma
   * corrida guarda `fecha_ejecucion`, así que la vez siguiente los dos lados
   * dicen lo mismo y no hay nada que registrar. Es la diferencia con
   * `borradoDeEspejo`, donde frenar deja los datos enteros — y es justo esa
   * comparación la que hacía parecer esto reintentable.
   */
  it("y el mensaje dice que no se recuperan, porque no se recuperan", () => {
    const cuantas = TOPE_DE_FILAS_POR_CORRIDA + 1;
    const r = lasQueHayQueRegistrar(
      Array.from({ length: cuantas }, (_, i) => sistema({ ot_number: 1000 + i })),
      Array.from({ length: cuantas }, (_, i) => planilla({ ot_number: 1000 + i })),
      SIN_HISTORIAL
    );
    expect(r.freno).toContain("no los recupera");
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

describe("TOPE_DE_FILAS_POR_CORRIDA", () => {
  /**
   * El valor fijado, no calculado, por lo mismo que `gut.test.ts` fija el 27:
   * acá el número ES la decisión. Todos los tests de arriba se derivan de la
   * constante, así que subirla a 500 los dejaría a todos en verde mientras el
   * freno se vuelve la defensa decorativa contra la que argumenta su propio
   * encabezado — hoy hay 64 órdenes abiertas en toda la base, que es el
   * universo entero de candidatas de una corrida, así que un tope de 64 para
   * arriba no puede dispararse nunca. Si este test falla, lo que hay que mirar
   * no es el número sino si sigue siendo alcanzable.
   */
  it("vale 10, y bajar de ese techo es lo que lo hace alcanzable", () => {
    expect(TOPE_DE_FILAS_POR_CORRIDA).toBe(10);
  });
});

describe("laUltimaPorOt", () => {
  const idDe = new Map([[2969, "ot-a"], [2970, "ot-b"]]);

  it("sin historial no devuelve nada", () => {
    expect(laUltimaPorOt([], idDe).size).toBe(0);
  });

  /**
   * Los dos sentidos, y es el punto entero del test: la función se queda con
   * la última **en el orden en que vienen** y no reordena. Si alguna vez
   * reordenara sola, estos dos casos darían lo mismo y la protección contra
   * duplicados dependería de algo que nadie comprueba.
   */
  it("con dos filas de la misma OT gana la última del orden recibido", () => {
    const r = laUltimaPorOt([
      { ot_id: "ot-a", fecha_nueva: "2026-11-13" },
      { ot_id: "ot-a", fecha_nueva: "2026-11-27" },
    ], idDe);
    expect(r.get(2969)).toBe("2026-11-27");
  });

  it("y al revés gana la otra, porque el orden lo pone quien consulta", () => {
    const r = laUltimaPorOt([
      { ot_id: "ot-a", fecha_nueva: "2026-11-27" },
      { ot_id: "ot-a", fecha_nueva: "2026-11-13" },
    ], idDe);
    expect(r.get(2969)).toBe("2026-11-13");
  });

  it("separa las OT entre sí", () => {
    const r = laUltimaPorOt([
      { ot_id: "ot-a", fecha_nueva: "2026-11-13" },
      { ot_id: "ot-b", fecha_nueva: "2026-11-20" },
      { ot_id: "ot-a", fecha_nueva: "2026-11-27" },
    ], idDe);
    expect([...r.entries()].sort()).toEqual([[2969, "2026-11-27"], [2970, "2026-11-20"]]);
  });

  it("ignora el historial de una OT que ya no está", () => {
    const r = laUltimaPorOt([{ ot_id: "ot-borrada", fecha_nueva: "2026-11-27" }], idDe);
    expect(r.size).toBe(0);
  });

  /** Lo que de verdad hace falta: que lo que sale sirva para frenar el duplicado. */
  it("lo que devuelve es lo que frena el duplicado", () => {
    const ultima = laUltimaPorOt([{ ot_id: "ot-a", fecha_nueva: "2026-11-27" }], idDe);
    const r = lasQueHayQueRegistrar([sistema()], [planilla()], ultima);
    expect(r.filas).toEqual([]);
  });
});
