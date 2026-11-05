import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./escribirEnGoogle", async (original) => ({
  ...(await original<typeof import("./escribirEnGoogle")>()),
  escribirEnGoogle: vi.fn(),
}));

import { escribirEnGoogle } from "./escribirEnGoogle";
import { mandarLaOTAlCalendario, type PedidoDeMandar } from "./mandarLaOT";
import { baseEnMemoria, type Fila } from "./baseEnMemoria.testhelper";
import { AVISO_DE_TOPE, claveDelHueco } from "./apilado";
import { AVISO_DE_BORRADO } from "./elEventoSigueALaOT";
import { CASILLA_DE_MANTENIMIENTO } from "./evento";

/** Las 09:00 de Argentina del 04/11/2026, o sea «hoy» es el 04. */
const AHORA = new Date("2026-11-04T12:00:00.000Z");
const LA_OT = "11111111-1111-4111-8111-111111111111";

/** La hora de pared de Argentina como el instante que se guarda. */
const instante = (horaDePared: string) => `${horaDePared}.000Z`;
const A_LAS_8 = instante("2026-11-06T11:00:00");
const A_LAS_9_30 = instante("2026-11-06T12:30:00");

function orden(extra: Fila = {}): Fila {
  return {
    id: LA_OT,
    ot_number: 2951,
    fecha_ejecucion: "2026-11-06",
    fecha_ejecucion_pendiente: null,
    fecha_cierre: null,
    estado: "PENDIENTE",
    created_by: null,
    equipo_raw: "Molino de cal",
    equipo_code: null,
    sector_raw: "Molienda",
    especialidad: "MECÁNICO",
    tipo: "PROGRAMADO",
    descripcion: "Cambio de correas",
    ...extra,
  };
}

/**
 * El evento de **otra** OT ya puesto ese día. La especialidad va embebida como
 * la trae el `select`: la base en memoria no resuelve embeds. El turno también
 * cuenta para el grupo (`claveDelHueco`), así que tiene que estar.
 */
function eventoDeOtraOT(id: string, inicio: string, especialidad: string, turno = "8-16"): Fila {
  return {
    id,
    ot_id: `otra-${id}`,
    dueno_id: "u-mant",
    casilla: CASILLA_DE_MANTENIMIENTO,
    google_event_id: `g-${id}`,
    divergencia: null,
    inicio,
    fin: inicio,
    turno,
    ordenes_trabajo: { especialidad },
  };
}

/** El evento que ya tiene **esta** OT. */
function eventoDeLaOT(extra: Fila = {}): Fila {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    ot_id: LA_OT,
    dueno_id: "u-mant",
    casilla: CASILLA_DE_MANTENIMIENTO,
    google_event_id: "g-viejo",
    divergencia: null,
    titulo: "OT 2951 · Molino de cal",
    descripcion: null,
    lugar: null,
    inicio: A_LAS_8,
    fin: A_LAS_9_30,
    turno: "8-16",
    ordenes_trabajo: { especialidad: "MECÁNICO" },
    ...extra,
  };
}

function base(tablas: Record<string, Fila[]> = {}) {
  return baseEnMemoria({
    ordenes_trabajo: [orden()],
    agenda_eventos: [],
    agenda_invitados: [],
    // La casilla del área, escrita con otras mayúsculas: se busca con `ilike`.
    usuarios: [{ id: "u-mant", email: "Mantenimiento@Polcecal.com", activo: true }],
    ...tablas,
  });
}

/** Nueve mecánicas ya puestas el 06/11: el día está completo hasta las 20:00. */
const nueveYaPuestas = () =>
  Array.from({ length: 9 }, (_, i) => eventoDeOtraOT(`e${i + 1}`, A_LAS_8, "MECÁNICO"));

/** El automático: sin turno, sin invitados extra y sin pisar nada. */
const AUTOMATICO: PedidoDeMandar = { turno: null, invitadosExtra: [], pisar: false };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(escribirEnGoogle).mockResolvedValue({
    google_event_id: "g1",
    inicio_escrito: "2026-11-06T08:00:00-03:00",
    fin_escrito: "2026-11-06T09:30:00-03:00",
  });
});

describe("claveDelHueco", () => {
  it("normaliza la especialidad como el apilado, para que nadie rearme la clave a mano", () => {
    expect(claveDelHueco("2026-11-06", "  mecánico ", "8-16")).toBe("2026-11-06|MECANICO|8-16");
    expect(claveDelHueco("2026-11-06", null, "8-16")).toBe("2026-11-06|(sin especialidad)|8-16");
  });

  /**
   * Vive en `apilado.ts` y no acá justamente para que haya **una sola**: con
   * una clave por camino, el mismo evento recibía un hueco distinto según cuál
   * de los dos lo tocó último, y eso deriva solo sin que nada avise.
   */
  it("el turno es parte del grupo: dos turnos no se apilan juntos", () => {
    expect(claveDelHueco("2026-11-06", "MECÁNICO", "4-12"))
      .not.toBe(claveDelHueco("2026-11-06", "MECÁNICO", "8-16"));
  });
});

describe("mandar una OT al calendario", () => {
  it("la primera del día y la especialidad arranca a las 08:00", async () => {
    const b = base();

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: true, reemplazo: false, inicio: A_LAS_8, enGoogle: true, pendiente: null });
    expect(b.tablas.agenda_eventos).toHaveLength(1);
    expect(b.tablas.agenda_eventos[0]).toMatchObject({
      ot_id: LA_OT,
      inicio: A_LAS_8,
      fin: A_LAS_9_30,
      turno: "8-16",
      casilla: CASILLA_DE_MANTENIMIENTO,
    });
  });

  it("la segunda mecánica del mismo día arranca a las 09:30", async () => {
    const b = base({ agenda_eventos: [eventoDeOtraOT("e1", A_LAS_8, "MECÁNICO")] });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: true, inicio: A_LAS_9_30 });
  });

  /** El caso que hace útil el apilado: no comparten gente, sí pueden la hora. */
  it("una eléctrica el mismo día vuelve a arrancar a las 08:00", async () => {
    const b = base({
      ordenes_trabajo: [orden({ especialidad: "ELÉCTRICO" })],
      agenda_eventos: [eventoDeOtraOT("e1", A_LAS_8, "MECÁNICO")],
    });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: true, inicio: A_LAS_8 });
  });

  /**
   * La misma afirmación que «un evento del turno 4-12 se recalcula desde las
   * 04:00» en `elEventoSigueALaOT.test.ts`, por el otro camino: los dos cuentan
   * con `claveDelHueco`, así que agrupan igual. Antes el alta contaba por
   * día+especialidad y el barrido por día+especialidad+turno, y el mismo evento
   * terminaba en una hora distinta según cuál lo tocó último.
   */
  it("una mecánica del turno de 4 no corre el hueco de la automática, que es del de 8", async () => {
    const b = base({ agenda_eventos: [eventoDeOtraOT("e1", instante("2026-11-06T07:00:00"), "MECÁNICO", "4-12")] });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: true, inicio: A_LAS_8 });
  });

  it("con turno explícito usa ese turno y no el hueco", async () => {
    const b = base({ agenda_eventos: [eventoDeOtraOT("e1", A_LAS_8, "MECÁNICO")] });

    const r = await mandarLaOTAlCalendario(
      b.cliente,
      LA_OT,
      { turno: "12-20", invitadosExtra: [], pisar: false },
      AHORA
    );

    // Las 12:00 de pared, no las 09:30 que habría dado el apilado.
    expect(r).toMatchObject({ ok: true, inicio: instante("2026-11-06T15:00:00") });
    expect(b.tablas.agenda_eventos.find((f) => f.ot_id === LA_OT)).toMatchObject({ turno: "12-20" });
  });

  it("reenviar una OT que ya tiene evento lo mueve y no lo duplica", async () => {
    const b = base({ agenda_eventos: [eventoDeLaOT()] });

    const r = await mandarLaOTAlCalendario(
      b.cliente,
      LA_OT,
      { turno: "4-12", invitadosExtra: [], pisar: false },
      AHORA
    );

    expect(r).toMatchObject({ ok: true, reemplazo: true, inicio: instante("2026-11-06T07:00:00") });
    expect(b.tablas.agenda_eventos).toHaveLength(1);
    expect(b.tablas.agenda_eventos[0].id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("el dueño de un evento que ya existía no cambia al reenviarlo", async () => {
    const b = base({
      agenda_eventos: [eventoDeLaOT({ dueno_id: "u-otro", casilla: "soporte.mantenimiento@polcecal.com" })],
    });

    await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(b.tablas.agenda_eventos[0]).toMatchObject({
      dueno_id: "u-otro",
      casilla: "soporte.mantenimiento@polcecal.com",
    });
    // Y se le escribe al calendario de esa casilla, no al de la del área.
    expect(vi.mocked(escribirEnGoogle).mock.calls[0][1].casilla).toBe("soporte.mantenimiento@polcecal.com");
  });

  /** El automático no pisa a nadie: pisar es un acto de una persona. */
  it("sin `pisar`, una OT con evento divergido devuelve 409 y no toca nada", async () => {
    const b = base({ agenda_eventos: [eventoDeLaOT({ divergencia: "movido" })] });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: false, estado: 409, requiereConfirmacion: true });
    expect(b.escrituras).toEqual([]);
    expect(escribirEnGoogle).not.toHaveBeenCalled();
  });

  it("si Google falla, el evento igual queda y con `google_pendiente`", async () => {
    const b = base();
    vi.mocked(escribirEnGoogle).mockResolvedValue({ pendiente: "Google dijo: 500" });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: true, enGoogle: false, pendiente: "Google dijo: 500" });
    expect(b.tablas.agenda_eventos[0]).toMatchObject({
      inicio: A_LAS_8,
      google_pendiente: "Google dijo: 500",
      google_pendiente_el: AHORA.toISOString(),
    });
  });

  it("una OT cerrada se rechaza con 400", async () => {
    const b = base({ ordenes_trabajo: [orden({ estado: "REALIZADO" })] });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: false, estado: 400 });
    expect(b.tablas.agenda_eventos).toHaveLength(0);
  });

  /**
   * El hueco sale de lo que **hay en la base**: no existe otra fuente. Un barrido
   * que manda varias en una pasada no necesita adelantar nada, porque cada
   * orden se escribe antes de contar la siguiente (ver `barridoDeNuevas`).
   */
  it("con dos mecánicas ya puestas ese día, la tercera arranca a las 11:00", async () => {
    const b = base({
      agenda_eventos: [
        eventoDeOtraOT("e1", A_LAS_8, "MECÁNICO"),
        eventoDeOtraOT("e2", A_LAS_9_30, "MECÁNICO"),
      ],
    });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: true, inicio: instante("2026-11-06T14:00:00") });
  });

  /**
   * El evento de la propia orden no cuenta para su hueco. Es el camino que la
   * pantalla del plan recorre sin saberlo: reenvía con `turno: null` cuando el
   * evento que ya existe es `8-16`. Si se contara, cada reenvío la correría
   * 1:30 —y avisaría por correo a cuatro personas cada vez—.
   */
  it("al reenviarla en automático, su propio evento no cuenta y sigue a las 08:00", async () => {
    const b = base({ agenda_eventos: [eventoDeLaOT()] });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);
    expect(r).toMatchObject({ ok: true, reemplazo: true, inicio: A_LAS_8 });

    // Y dos veces seguidas da lo mismo: no deriva.
    const otraVez = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);
    expect(otraVez).toMatchObject({ ok: true, inicio: A_LAS_8 });
  });

  it("la décima del día comparte las 20:00 y lo dice en la advertencia y en el aviso", async () => {
    const b = base({ agenda_eventos: nueveYaPuestas() });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: true, inicio: instante("2026-11-06T23:00:00") });
    expect(r.ok && r.advertencias).toContain(AVISO_DE_TOPE);
    // Va a `aviso` y no a `google_pendiente`: hay algo que mirar, no algo que escribir.
    expect(b.tablas.agenda_eventos.find((e) => e.ot_id === LA_OT)).toMatchObject({ aviso: AVISO_DE_TOPE, google_pendiente: null });
  });

  it("reenviarla fuera del tope limpia ese aviso, pero no el de un borrado que Google rechazó", async () => {
    // Dos escritores de la misma columna, y cada uno limpia sólo lo suyo:
    // pisar el del borrado perdería lo único que dice que quedó un evento vivo
    // en cinco calendarios.
    const conTope = base({ agenda_eventos: [eventoDeLaOT({ aviso: AVISO_DE_TOPE })] });
    await mandarLaOTAlCalendario(conTope.cliente, LA_OT, AUTOMATICO, AHORA);
    expect(conTope.tablas.agenda_eventos[0].aviso).toBeNull();

    const deBorrado = `${AVISO_DE_BORRADO}. Google dijo: 503`;
    const conBorrado = base({ agenda_eventos: [eventoDeLaOT({ aviso: deBorrado })] });
    await mandarLaOTAlCalendario(conBorrado.cliente, LA_OT, AUTOMATICO, AHORA);
    expect(conBorrado.tablas.agenda_eventos[0].aviso).toBe(deBorrado);
  });

  it("y el del tope tampoco se le escribe encima al de un borrado que Google rechazó", async () => {
    // La otra punta del mismo agujero: no alcanza con no limpiarlo a ciegas, el
    // tope tampoco lo pisa. El del borrado es el único registro de un evento
    // vivo en cinco calendarios que ya ninguna fila nombra; el del tope se
    // vuelve a deducir del horario. La advertencia en pantalla igual lo dice.
    const deBorrado = `${AVISO_DE_BORRADO}. Google dijo: 503`;
    const b = base({ agenda_eventos: [eventoDeLaOT({ aviso: deBorrado }), ...nueveYaPuestas()] });

    const r = await mandarLaOTAlCalendario(b.cliente, LA_OT, AUTOMATICO, AHORA);

    expect(r).toMatchObject({ ok: true, inicio: instante("2026-11-06T23:00:00") });
    expect(r.ok && r.advertencias).toContain(AVISO_DE_TOPE);
    expect(b.tablas.agenda_eventos[0].aviso).toBe(deBorrado);
  });
});
