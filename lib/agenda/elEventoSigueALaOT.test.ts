import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/core/calendar", () => ({
  crearEvento: vi.fn(),
  actualizarEvento: vi.fn(),
  restaurarEvento: vi.fn(),
  borrarEvento: vi.fn(),
  leerEvento: vi.fn(),
}));

import { crearEvento, actualizarEvento, borrarEvento } from "@/lib/core/calendar";
import {
  queHacerConElEvento, planDelEvento, seguirALasOT, borrarLosEventosDeLasOT, fechaDelEvento, AVISO_DE_BORRADO,
} from "./elEventoSigueALaOT";

beforeEach(() => {
  vi.mocked(crearEvento).mockReset();
  vi.mocked(actualizarEvento).mockReset();
  vi.mocked(borrarEvento).mockReset();
});

/** 08:00 de Argentina del 03/11/2026, como lo devuelve la base. */
const INICIO = "2026-11-03T11:00:00+00:00";
const FIN = "2026-11-03T12:30:00+00:00";

const evento = (extra: Record<string, unknown> = {}) => ({
  inicio: INICIO, turno: "8-16" as const, divergencia: null as string | null, ...extra,
});

describe("queHacerConElEvento", () => {
  it("si la fecha cambió, el evento se mueve al mismo turno", () => {
    expect(queHacerConElEvento(evento(), "2026-11-10")).toEqual({
      accion: "mover", inicio: "2026-11-10T08:00:00", fin: "2026-11-10T09:30:00",
    });
    expect(queHacerConElEvento(evento({ turno: "12-20" }), "2026-11-10")).toEqual({
      accion: "mover", inicio: "2026-11-10T12:00:00", fin: "2026-11-10T13:30:00",
    });
  });

  it("si la fecha es la misma, no se toca", () => {
    expect(queHacerConElEvento(evento(), "2026-11-03")).toEqual({
      accion: "no tocar", motivo: expect.any(String),
    });
  });

  it("el día se mira en hora de Argentina y no en UTC", () => {
    // 23:00 de Argentina del 03/11 es 02:00 UTC del 04/11.
    const tarde = evento({ inicio: "2026-11-04T02:00:00+00:00" });
    expect(fechaDelEvento(tarde.inicio)).toBe("2026-11-03");
    expect(queHacerConElEvento(tarde, "2026-11-03").accion).toBe("no tocar");
  });

  // La decisión 16 de la spec, y la que choca con la 10.
  it("un evento que ya divergió no se pisa", () => {
    for (const divergencia of ["movido", "borrado"]) {
      expect(queHacerConElEvento(evento({ divergencia }), "2026-11-10"))
        .toEqual({ accion: "no tocar", motivo: expect.stringContaining("divergió") });
    }
  });

  // Un fecha que desaparece no es "la OT se borró" ni "cambió de fecha".
  it("si la planilla vacía la fecha, el evento queda y se avisa", () => {
    expect(queHacerConElEvento(evento(), null))
      .toEqual({ accion: "avisar", motivo: expect.stringContaining("sin fecha de ejecución") });
  });

  it("vaciada gana sobre divergido: el evento tampoco se toca, pero lo que hay que decir es otra cosa", () => {
    expect(queHacerConElEvento(evento({ divergencia: "movido" }), null).accion).toBe("avisar");
  });

  // La decisión que se tomó sabiendo lo que cuesta: la fecha de la OT es la autoridad.
  it("al mover, vuelve al horario del turno y descarta una hora que alguien aceptó de Google", () => {
    // Alguien aceptó las 09:30 (12:30Z) para el día 03.
    const aceptada = evento({ inicio: "2026-11-03T12:30:00+00:00" });
    expect(queHacerConElEvento(aceptada, "2026-11-10")).toEqual({
      accion: "mover", inicio: "2026-11-10T08:00:00", fin: "2026-11-10T09:30:00",
    });
    // Si la fecha no cambió, la hora aceptada se respeta: no se compara la hora.
    expect(queHacerConElEvento(aceptada, "2026-11-03").accion).toBe("no tocar");
  });

  it("una fecha mal formada no se escribe: se avisa", () => {
    for (const mala of ["10/11/2026", "2026-13-40", "mañana"]) {
      expect(queHacerConElEvento(evento(), mala)).toEqual({
        accion: "avisar", motivo: expect.stringContaining("no es una fecha válida"),
      });
    }
  });

  it("un evento sin turno no se mueve a una hora inventada", () => {
    expect(queHacerConElEvento(evento({ turno: null }), "2026-11-10").accion).toBe("avisar");
  });
});

describe("planDelEvento", () => {
  const orden = (extra: Record<string, unknown> = {}) => ({
    fecha_ejecucion: "2026-11-10", fecha_ejecucion_pendiente: null, fecha_cierre: null, ...extra,
  });
  const fila = (e: Record<string, unknown> = {}, o: Record<string, unknown> = {}) =>
    ({ ...evento(), aviso: null as string | null, orden: orden(o), ...e });

  it("una OT cerrada no se toca, cambie o no su fecha, o esté vacía", () => {
    for (const fecha_ejecucion of ["2026-11-10", null]) {
      expect(planDelEvento(fila({}, { fecha_cierre: "2026-11-04", fecha_ejecucion })))
        .toEqual({ tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false });
    }
  });

  it("una OT REALIZADA sin fecha_cierre tampoco se toca (168 de 986 están así)", () => {
    expect(planDelEvento(fila({}, { fecha_cierre: null, estado: "REALIZADO" })))
      .toEqual({ tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false });
    // SUSPENDIDA es una pausa y no una terminación: su evento sigue a la fecha.
    expect(planDelEvento(fila({}, { fecha_cierre: null, estado: "SUSPENDIDA" })).tipo).toBe("mover");
  });

  it("mueve, y se lleva el aviso viejo si lo había", () => {
    expect(planDelEvento(fila()).mover).toEqual({ inicio: "2026-11-10T08:00:00", fin: "2026-11-10T09:30:00" });
    expect(planDelEvento(fila()).aviso).toBeUndefined();
    expect(planDelEvento(fila({ aviso: "algo viejo" })).aviso).toBeNull();
  });

  it("usa la fecha pendiente cuando la hay: es la que el SdG acaba de fijar", () => {
    const p = planDelEvento(fila({}, { fecha_ejecucion: "2026-11-03", fecha_ejecucion_pendiente: "2026-11-12" }));
    expect(p.mover?.inicio).toBe("2026-11-12T08:00:00");
  });

  it("fecha vaciada: no mueve, escribe el aviso, y no lo reescribe la corrida siguiente", () => {
    const primera = planDelEvento(fila({}, { fecha_ejecucion: null }));
    expect(primera).toMatchObject({ tipo: "avisar", mover: null, volverAAlertar: false });
    expect(primera.aviso).toContain("sin fecha de ejecución");

    const segunda = planDelEvento(fila({ aviso: primera.aviso as string }, { fecha_ejecucion: null }));
    expect(segunda).toEqual({ tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false });
  });

  it("divergido: no mueve, avisa y vuelve a alertar UNA vez, no en cada corrida", () => {
    const primera = planDelEvento(fila({ divergencia: "movido" }));
    expect(primera).toMatchObject({ tipo: "respetar", mover: null, volverAAlertar: true });
    expect(primera.aviso).toContain("divergió");

    const segunda = planDelEvento(fila({ divergencia: "movido", aviso: primera.aviso as string }));
    expect(segunda.volverAAlertar).toBe(false);
    expect(segunda.mover).toBeNull();
    expect(segunda.tipo).toBe("nada");
  });

  it("divergido y la fecha cambia otra vez: es una novedad nueva y vuelve a alertar", () => {
    const una = planDelEvento(fila({ divergencia: "movido" }));
    const otra = planDelEvento(
      fila({ divergencia: "movido", aviso: una.aviso as string }, { fecha_ejecucion: "2026-11-17" })
    );
    expect(otra.volverAAlertar).toBe(true);
  });

  it("al volver la fecha al día del evento, el aviso que ya no es cierto se limpia", () => {
    const p = planDelEvento(fila({ aviso: "La orden pasó al…" }, { fecha_ejecucion: "2026-11-03" }));
    expect(p).toEqual({ tipo: "nada", mover: null, aviso: null, volverAAlertar: false });
  });
});

// ── Con la base y Google de mentira ─────────────────────────────────────────

const ENGOOGLE = (inicio: string, fin: string) => ({
  id: "g1", inicio, fin, cancelado: false, invitados: [],
});

interface Hecho { tabla: string; op: string; columnas?: Record<string, unknown>; donde?: string }

function clienteFalso(opciones: {
  eventos?: Record<string, unknown>[];
  invitados?: { email: string }[];
  falla?: Partial<Record<"leer" | "update", string>>;
} = {}) {
  const hechos: Hecho[] = [];
  const cliente = {
    from: (tabla: string) => {
      const self: Record<string, unknown> = {};
      let filtro = "";
      for (const m of ["select", "not", "order", "range", "returns"]) self[m] = () => self;
      self.in = (_c: string, v: unknown) => { filtro = `in ${JSON.stringify(v)}`; return self; };
      self.eq = (_c: string, v: unknown) => { filtro = `eq ${v}`; return self; };
      self.then = (resolver: (v: unknown) => unknown) => {
        hechos.push({ tabla, op: "leer", donde: filtro });
        const error = opciones.falla?.leer ? { message: opciones.falla.leer } : null;
        const data = tabla === "agenda_eventos" ? (opciones.eventos ?? []) : (opciones.invitados ?? []);
        return Promise.resolve({ data: error ? null : data, error }).then(resolver);
      };
      self.update = (columnas: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => {
          hechos.push({ tabla, op: "update", columnas, donde: id });
          return Promise.resolve({ error: opciones.falla?.update ? { message: opciones.falla.update } : null });
        },
      });
      return self;
    },
  };
  return { cliente: cliente as never, hechos };
}

const FILA_DE_EVENTO = (extra: Record<string, unknown> = {}) => ({
  id: "01234567-89ab-cdef-0123-456789abcdef",
  titulo: "OT 2900 · Molino", descripcion: "x", lugar: "Planta",
  inicio: INICIO, fin: FIN, casilla: "mantenimiento@polcecal.com",
  google_event_id: "0123456789abcdef0123456789abcdef",
  divergencia: null, aviso: null, turno: "8-16", ot_id: "ot-1",
  ordenes_trabajo: {
    ot_number: 2900, fecha_ejecucion: "2026-11-10", fecha_ejecucion_pendiente: null, fecha_cierre: null,
  },
  ...extra,
});

describe("seguirALasOT", () => {
  it("mueve la fila, escribe en Google, y anota lo que Google devolvió y no lo que se mandó", async () => {
    vi.mocked(actualizarEvento).mockResolvedValue(
      ENGOOGLE("2026-11-10T08:00:00-03:00", "2026-11-10T09:30:00-03:00")
    );
    const { cliente, hechos } = clienteFalso({
      eventos: [FILA_DE_EVENTO()], invitados: [{ email: "Gerencia@polcecal.com" }],
    });

    const r = await seguirALasOT(cliente);

    expect(r).toMatchObject({ movidos: 1, pendientes: 0, fallos: [] });
    const updates = hechos.filter((h) => h.op === "update");
    // Primero la fila (el SdG es el dueño del dato), después lo de Google.
    expect(updates[0].columnas).toEqual({
      inicio: "2026-11-10T11:00:00.000Z", fin: "2026-11-10T12:30:00.000Z",
      google_pendiente: expect.any(String), google_pendiente_el: expect.any(String),
    });
    expect(updates[1].columnas).toMatchObject({
      inicio_escrito: "2026-11-10T08:00:00-03:00", fin_escrito: "2026-11-10T09:30:00-03:00",
      google_pendiente: null, google_pendiente_el: null,
    });
    const [, , cuerpo] = vi.mocked(actualizarEvento).mock.calls[0];
    expect(cuerpo).toMatchObject({ inicio: "2026-11-10T08:00:00", fin: "2026-11-10T09:30:00", invitados: ["gerencia@polcecal.com"] });
  });

  it("el horario nuevo y el pendiente van en el MISMO update: una muerte antes de Google no deja una divergencia silenciosa", async () => {
    // Sin el pendiente, la fila queda con el día nuevo, Google con el viejo y `escrito`
    // con el viejo, y nadie lo ve: la corrida compara fila contra OT y el webhook
    // compara `escrito` contra Google.
    let updatesAntesDeGoogle = -1;
    const { cliente, hechos } = clienteFalso({ eventos: [FILA_DE_EVENTO()] });
    vi.mocked(actualizarEvento).mockImplementation(async () => {
      updatesAntesDeGoogle = hechos.filter((h) => h.op === "update").length;
      return ENGOOGLE("2026-11-10T08:00:00-03:00", "2026-11-10T09:30:00-03:00");
    });
    await seguirALasOT(cliente);
    expect(updatesAntesDeGoogle).toBe(1);
    const [primero] = hechos.filter((h) => h.op === "update");
    expect(primero.columnas).toMatchObject({ inicio: expect.any(String), google_pendiente: expect.any(String) });
  });

  it("un evento sin filas de invitados no manda `invitados`: `attendees: []` borraría a los cinco", async () => {
    vi.mocked(actualizarEvento).mockResolvedValue(ENGOOGLE("2026-11-10T08:00:00-03:00", "2026-11-10T09:30:00-03:00"));
    const { cliente } = clienteFalso({ eventos: [FILA_DE_EVENTO()], invitados: [] });
    await seguirALasOT(cliente);
    const [, , cuerpo] = vi.mocked(actualizarEvento).mock.calls[0];
    expect((cuerpo as { invitados?: string[] }).invitados).toBeUndefined();
  });

  it("el aviso de un borrado fallido no lo limpia un movimiento; el que escribió esta lógica sí", async () => {
    vi.mocked(actualizarEvento).mockResolvedValue(ENGOOGLE("2026-11-10T08:00:00-03:00", "2026-11-10T09:30:00-03:00"));

    const deBorrado = clienteFalso({ eventos: [FILA_DE_EVENTO({ aviso: `${AVISO_DE_BORRADO}. Google dijo: 503` })] });
    await seguirALasOT(deBorrado.cliente);
    expect(deBorrado.hechos.find((h) => h.op === "update")?.columnas).not.toHaveProperty("aviso");

    const viejo = clienteFalso({ eventos: [FILA_DE_EVENTO({ aviso: "La planilla dejó la orden sin fecha de ejecución…" })] });
    await seguirALasOT(viejo.cliente);
    expect(viejo.hechos.find((h) => h.op === "update")?.columnas).toMatchObject({ aviso: null });
  });

  it("con Google lento corta a los 60 s: lo que falta queda para la próxima corrida", async () => {
    // Cada llamada a Google tarda 40 s de reloj. Con diez eventos y Google colgado
    // serían 300 s: lo que tumba al cron entero.
    let t = 0;
    vi.mocked(actualizarEvento).mockImplementation(async () => {
      t += 40_000;
      return ENGOOGLE("2026-11-10T08:00:00-03:00", "2026-11-10T09:30:00-03:00");
    });
    const { cliente, hechos } = clienteFalso({
      eventos: [1, 2, 3, 4].map((n) => FILA_DE_EVENTO({ id: `0000000${n}-89ab-cdef-0123-456789abcdef` })),
    });

    const r = await seguirALasOT(cliente, { limiteMs: 60_000, reloj: () => t });

    expect(actualizarEvento).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ movidos: 2, sinAlcanzar: 2, fallos: [] });
    // Los que no se alcanzaron no se tocaron: ni la fila ni Google.
    const tocados = new Set(hechos.filter((h) => h.op === "update").map((h) => h.donde));
    expect(tocados.size).toBe(2);
  });

  it("un evento divergido no se escribe en Google aunque la fecha cambió, y la alerta vuelve", async () => {
    const { cliente, hechos } = clienteFalso({ eventos: [FILA_DE_EVENTO({ divergencia: "movido" })] });

    const r = await seguirALasOT(cliente, { ahora: new Date("2026-11-05T12:00:00Z") });

    expect(r).toMatchObject({ movidos: 0, respetados: 1, fallos: [] });
    expect(actualizarEvento).not.toHaveBeenCalled();
    expect(crearEvento).not.toHaveBeenCalled();
    const [u] = hechos.filter((h) => h.op === "update");
    expect(u.columnas).toMatchObject({
      divergencia: "movido", divergencia_el: "2026-11-05T12:00:00.000Z",
      aviso: expect.stringContaining("divergió"),
    });
    // La fila no se movió: el evento queda en el día viejo, a propósito.
    expect(u.columnas).not.toHaveProperty("inicio");
  });

  it("la fecha vaciada deja el evento y escribe el aviso; no es un pendiente", async () => {
    const { cliente, hechos } = clienteFalso({
      eventos: [FILA_DE_EVENTO({
        ordenes_trabajo: { ot_number: 2900, fecha_ejecucion: null, fecha_ejecucion_pendiente: null, fecha_cierre: null },
      })],
    });
    const r = await seguirALasOT(cliente);
    expect(r).toMatchObject({ avisados: 1, movidos: 0 });
    const [u] = hechos.filter((h) => h.op === "update");
    expect(u.columnas).toEqual({ aviso: expect.stringContaining("sin fecha de ejecución") });
    expect(actualizarEvento).not.toHaveBeenCalled();
  });

  it("un fallo de Google va a la cola y la fila queda movida", async () => {
    vi.mocked(actualizarEvento).mockRejectedValue(new Error("Google respondió 500: backendError"));
    const { cliente, hechos } = clienteFalso({ eventos: [FILA_DE_EVENTO()] });

    const r = await seguirALasOT(cliente);

    expect(r).toMatchObject({ movidos: 1, pendientes: 1, fallos: [] });
    const updates = hechos.filter((h) => h.op === "update");
    expect(updates[1].columnas).toEqual({
      google_pendiente: "Google respondió 500: backendError", google_pendiente_el: expect.any(String),
    });
    // No se tocó lo escrito: no hubo escritura.
    expect(updates[1].columnas).not.toHaveProperty("inicio_escrito");
  });

  it("un evento que todavía no llegó a Google se crea en vez de actualizarse", async () => {
    vi.mocked(crearEvento).mockResolvedValue(
      ENGOOGLE("2026-11-10T08:00:00-03:00", "2026-11-10T09:30:00-03:00")
    );
    const { cliente } = clienteFalso({ eventos: [FILA_DE_EVENTO({ google_event_id: null })] });
    await seguirALasOT(cliente);
    expect(crearEvento).toHaveBeenCalledOnce();
    expect(actualizarEvento).not.toHaveBeenCalled();
  });

  it("una OT cerrada no se toca", async () => {
    const { cliente, hechos } = clienteFalso({
      eventos: [FILA_DE_EVENTO({
        ordenes_trabajo: { ot_number: 2900, fecha_ejecucion: "2026-11-10", fecha_ejecucion_pendiente: null, fecha_cierre: "2026-11-04" },
      })],
    });
    const r = await seguirALasOT(cliente);
    expect(r).toMatchObject({ movidos: 0, avisados: 0, respetados: 0 });
    expect(hechos.filter((h) => h.op === "update")).toEqual([]);
  });

  it("una OT REALIZADA sin fecha_cierre, con su evento y la fecha cambiada: no se mueve", async () => {
    const { cliente, hechos } = clienteFalso({
      eventos: [FILA_DE_EVENTO({
        ordenes_trabajo: {
          ot_number: 2900, fecha_ejecucion: "2026-11-10", fecha_ejecucion_pendiente: null,
          fecha_cierre: null, estado: "REALIZADO",
        },
      })],
    });
    const r = await seguirALasOT(cliente);
    expect(r).toMatchObject({ movidos: 0, avisados: 0, respetados: 0, pendientes: 0, fallos: [] });
    expect(hechos.filter((h) => h.op === "update")).toEqual([]);
    expect(actualizarEvento).not.toHaveBeenCalled();
    expect(crearEvento).not.toHaveBeenCalled();
  });

  it("si no puede guardar la fila, no escribe en Google y lo dice", async () => {
    const { cliente } = clienteFalso({ eventos: [FILA_DE_EVENTO()], falla: { update: "boom" } });
    const r = await seguirALasOT(cliente);
    expect(r.movidos).toBe(0);
    expect(r.fallos[0]).toContain("boom");
    expect(actualizarEvento).not.toHaveBeenCalled();
  });

  it("si no puede leer los eventos, no tira: lo dice", async () => {
    const { cliente } = clienteFalso({ falla: { leer: "no existe la tabla" } });
    const r = await seguirALasOT(cliente);
    expect(r.fallos[0]).toContain("no existe la tabla");
  });
});

/** Un aviso como el que deja un borrado fallido. */
const r_aviso = () => `${AVISO_DE_BORRADO}. Google dijo: Google respondió 503`;

describe("borrarLosEventosDeLasOT", () => {
  it("borra en Google y devuelve vacío cuando todo salió bien", async () => {
    vi.mocked(borrarEvento).mockResolvedValue();
    const { cliente } = clienteFalso({ eventos: [FILA_DE_EVENTO()] });
    const r = await borrarLosEventosDeLasOT(cliente, ["ot-1"]);
    expect(r.size).toBe(0);
    expect(borrarEvento).toHaveBeenCalledWith("mantenimiento@polcecal.com", "0123456789abcdef0123456789abcdef");
  });

  it("sin google_event_id igual intenta, por el id que sale de la fila", async () => {
    vi.mocked(borrarEvento).mockResolvedValue();
    const { cliente } = clienteFalso({ eventos: [FILA_DE_EVENTO({ google_event_id: null })] });
    await borrarLosEventosDeLasOT(cliente, ["ot-1"]);
    expect(borrarEvento).toHaveBeenCalledWith("mantenimiento@polcecal.com", "0123456789abcdef0123456789abcdef");
  });

  it("si el borrado en Google falla, esa OT queda en la lista de las que no se borran, y el fallo va a `aviso`, no a la cola", async () => {
    vi.mocked(borrarEvento).mockRejectedValue(new Error("Google respondió 503"));
    const { cliente, hechos } = clienteFalso({ eventos: [FILA_DE_EVENTO()] });
    const r = await borrarLosEventosDeLasOT(cliente, ["ot-1"]);
    expect([...r.keys()]).toEqual(["ot-1"]);
    expect(r.get("ot-1")).toContain("Google respondió 503");
    const [u] = hechos.filter((h) => h.op === "update");
    // El cron de reintento lee `google_pendiente` como «falta escribir» y resucitaría el evento.
    expect(u.columnas).toEqual({ aviso: expect.stringContaining("Google respondió 503") });
    expect(u.columnas).not.toHaveProperty("google_pendiente");
    expect(u.columnas).not.toHaveProperty("google_pendiente_el");
  });

  it("la sincronización no limpia ese aviso en la misma corrida que lo escribió", () => {
    // Después del borrado corre `seguirALasOT` y la orden sigue en la base con su fecha sin cambios.
    const aviso = r_aviso();
    const p = planDelEvento({
      ...evento(), aviso,
      orden: { fecha_ejecucion: "2026-11-03", fecha_ejecucion_pendiente: null, fecha_cierre: null },
    });
    expect(p).toEqual({ tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false });
  });

  it("con Google lento corta a los 60 s: las OT que faltan no se borran y se reintentan", async () => {
    let t = 0;
    vi.mocked(borrarEvento).mockImplementation(async () => { t += 40_000; });
    const { cliente } = clienteFalso({
      eventos: [1, 2, 3].map((n) => FILA_DE_EVENTO({ id: `0000000${n}-89ab-cdef-0123-456789abcdef`, ot_id: `ot-${n}` })),
    });

    const r = await borrarLosEventosDeLasOT(cliente, ["ot-1", "ot-2", "ot-3"], { limiteMs: 60_000, reloj: () => t });

    expect(borrarEvento).toHaveBeenCalledTimes(2);
    expect([...r.keys()]).toEqual(["ot-3"]);
    expect(r.get("ot-3")).toContain("Se agotó el tiempo");
  });

  it("si no puede ni mirar los eventos, ninguna OT del lote se borra", async () => {
    const { cliente } = clienteFalso({ falla: { leer: "timeout" } });
    const r = await borrarLosEventosDeLasOT(cliente, ["ot-1", "ot-2"]);
    expect([...r.keys()].sort()).toEqual(["ot-1", "ot-2"]);
    expect(borrarEvento).not.toHaveBeenCalled();
  });
});
