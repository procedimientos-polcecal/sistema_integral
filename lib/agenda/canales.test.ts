import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/core/calendar", () => ({
  abrirCanal: vi.fn(),
  cerrarCanal: vi.fn(),
  leerEvento: vi.fn(),
}));

import { abrirCanal, cerrarCanal, leerEvento } from "@/lib/core/calendar";
import {
  canalesARenovar, tokenValido, urlDelWebhook, revisarLaCasilla, ponerAlDiaLosCanales, barrerLasCasillas,
  conteoVacio, resumenDelConteo, lineaDeLosEventosMirados,
  ANTICIPO_DE_RENOVACION_MS,
} from "./canales";
import { baseEnMemoria, type Fila } from "./baseEnMemoria.testhelper";

const AHORA = new Date("2026-11-03T05:00:00.000Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();

describe("canalesARenovar", () => {
  it("una casilla sin canal se abre", () => {
    expect(canalesARenovar([], ["ana@polcecal.com"], AHORA)).toEqual([
      { casilla: "ana@polcecal.com", motivo: "no existe" },
    ]);
  });

  it("un canal que vence dentro de 24 h se renueva", () => {
    const r = canalesARenovar([{ casilla: "ana@polcecal.com", vence: enHoras(24) }], ["ana@polcecal.com"], AHORA);
    expect(r).toEqual([{ casilla: "ana@polcecal.com", motivo: "vence pronto" }]);
  });

  it("un canal que vence dentro de una semana no se toca", () => {
    const r = canalesARenovar([{ casilla: "ana@polcecal.com", vence: enHoras(24 * 7) }], ["ana@polcecal.com"], AHORA);
    expect(r).toEqual([]);
  });

  it("una casilla que ya no es usuario no se renueva", () => {
    const r = canalesARenovar(
      [{ casilla: "baja@polcecal.com", vence: enHoras(1) }],
      ["ana@polcecal.com"],
      AHORA
    );
    expect(r).toEqual([{ casilla: "ana@polcecal.com", motivo: "no existe" }]);
    expect(r.map((c) => c.casilla)).not.toContain("baja@polcecal.com");
  });

  it("el margen es mayor que el período del cron: uno que vence en 30 h se renueva hoy", () => {
    // Con 24 h de margen quedaría vivo hasta mañana, y mañana ya lleva seis horas muerto.
    expect(ANTICIPO_DE_RENOVACION_MS).toBeGreaterThan(24 * 3_600_000);
    const r = canalesARenovar([{ casilla: "ana@polcecal.com", vence: enHoras(30) }], ["ana@polcecal.com"], AHORA);
    expect(r).toEqual([{ casilla: "ana@polcecal.com", motivo: "vence pronto" }]);
  });

  it("un canal que ya venció se renueva", () => {
    const r = canalesARenovar([{ casilla: "ana@polcecal.com", vence: enHoras(-5) }], ["ana@polcecal.com"], AHORA);
    expect(r).toEqual([{ casilla: "ana@polcecal.com", motivo: "vence pronto" }]);
  });

  it("un vence que no se puede leer se renueva, no se da por bueno", () => {
    const r = canalesARenovar([{ casilla: "ana@polcecal.com", vence: "mañana" }], ["ana@polcecal.com"], AHORA);
    expect(r).toEqual([{ casilla: "ana@polcecal.com", motivo: "vence pronto" }]);
  });

  it("compara las casillas sin mirar mayúsculas ni espacios, y no repite", () => {
    const r = canalesARenovar(
      [{ casilla: "Ana@Polcecal.com", vence: enHoras(24 * 7) }],
      [" ana@polcecal.com ", "ANA@polcecal.com", "", "  "],
      AHORA
    );
    expect(r).toEqual([]);
  });
});

describe("tokenValido", () => {
  it("el mismo token pasa", () => expect(tokenValido("abc123", "abc123")).toBe(true));
  it("uno distinto no", () => expect(tokenValido("abc124", "abc123")).toBe(false));
  it("uno de otro largo no", () => expect(tokenValido("abc", "abc123")).toBe(false));
  it("sin token no pasa", () => {
    expect(tokenValido(null, "abc123")).toBe(false);
    expect(tokenValido("", "abc123")).toBe(false);
  });
  it("un secreto vacío no coincide con nada, ni con un token vacío", () => {
    expect(tokenValido("", "")).toBe(false);
    expect(tokenValido("algo", "")).toBe(false);
    expect(tokenValido("algo", null)).toBe(false);
  });
});

describe("urlDelWebhook", () => {
  it("arma la ruta pública sobre el dominio completo", () => {
    expect(urlDelWebhook("https://www.polcecalpolysan.app")).toEqual({
      ok: true,
      url: "https://www.polcecalpolysan.app/api/agenda/google",
    });
  });
  it("no duplica la barra final", () => {
    expect(urlDelWebhook(" https://www.polcecalpolysan.app/ ")).toEqual({
      ok: true,
      url: "https://www.polcecalpolysan.app/api/agenda/google",
    });
  });
  it("sin la variable dice cuál es", () => {
    const r = urlDelWebhook(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/NEXT_PUBLIC_APP_URL/);
  });
  it("http, localhost y un host sin dominio no sirven para Google", () => {
    for (const url of ["http://www.polcecalpolysan.app", "https://localhost", "https://miservidor", "no es url"]) {
      expect(urlDelWebhook(url).ok, url).toBe(false);
    }
  });
});

// ── revisarLaCasilla ────────────────────────────────────────────────────────

const CASILLA = "mantenimiento@polcecal.com";

/** Un evento futuro de la casilla, ya escrito en Google. */
function evento(id: string, extra: Fila = {}): Fila {
  return {
    id,
    casilla: CASILLA,
    google_event_id: `g${id}`,
    inicio_escrito: "2026-11-04T11:00:00+00:00",
    fin_escrito: "2026-11-04T12:30:00+00:00",
    fin: "2026-11-04T12:30:00+00:00",
    divergencia: null,
    divergencia_el: null,
    ...extra,
  };
}

/** Lo que devuelve Google: con offset de Argentina, el mismo instante que `evento`. */
const IGUAL = {
  inicio: "2026-11-04T08:00:00-03:00",
  fin: "2026-11-04T09:30:00-03:00",
  cancelado: false,
  invitados: [] as { email: string; respuesta?: string }[],
};

beforeEach(() => vi.resetAllMocks());

describe("revisarLaCasilla", () => {
  it("un evento que Google devuelve cancelado (HTTP 200) es un borrado, y queda anotado", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockResolvedValue({ id: "g1", inicio: "", fin: "", cancelado: true, invitados: [] });

    const r = await revisarLaCasilla(base.cliente, CASILLA, [], AHORA);

    expect(r).toEqual([{ evento_id: "1", divergencia: "borrado" }]);
    expect(base.tablas.agenda_eventos[0]).toMatchObject({ divergencia: "borrado", divergencia_el: AHORA.toISOString() });
  });

  it("un id que Google no conoce (404, null) también es un borrado", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockResolvedValue(null);
    expect(await revisarLaCasilla(base.cliente, CASILLA, [], AHORA)).toEqual([{ evento_id: "1", divergencia: "borrado" }]);
  });

  it("un evento que alguien movió es «movido»", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockResolvedValue({
      id: "g1", ...IGUAL, inicio: "2026-11-04T10:00:00-03:00", fin: "2026-11-04T11:30:00-03:00",
    });
    expect(await revisarLaCasilla(base.cliente, CASILLA, [], AHORA)).toEqual([{ evento_id: "1", divergencia: "movido" }]);
    expect(base.tablas.agenda_eventos[0].divergencia).toBe("movido");
  });

  it("el mismo instante con otro offset no es un cambio (el eco de una escritura propia)", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockResolvedValue({ id: "g1", ...IGUAL });
    expect(await revisarLaCasilla(base.cliente, CASILLA, [], AHORA)).toEqual([]);
    expect(base.escrituras).toEqual([]);
  });

  it("un RSVP, un título cambiado o un invitado de más no son divergencia", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockResolvedValue({
      id: "g1", ...IGUAL,
      titulo: "Otro título",
      invitados: [
        { email: "a@polcecal.com", respuesta: "declined" },
        { email: "b@polcecal.com", respuesta: "accepted" },
        { email: "extra@gmail.com" },
      ],
    });
    expect(await revisarLaCasilla(base.cliente, CASILLA, [], AHORA)).toEqual([]);
    expect(base.escrituras).toEqual([]);
  });

  it("sólo mira las filas futuras de esa casilla que el SdG ya escribió y que no están divergidas", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [
        evento("1"),
        evento("2", { casilla: "otra@polcecal.com" }),
        evento("3", { fin: "2026-11-01T12:00:00+00:00" }),
        evento("4", { google_event_id: null }),
        evento("5", { inicio_escrito: null, fin_escrito: null }),
        evento("6", { divergencia: "movido", divergencia_el: "2026-11-02T10:00:00+00:00" }),
      ],
    });
    vi.mocked(leerEvento).mockResolvedValue({ id: "g1", ...IGUAL });

    await revisarLaCasilla(base.cliente, CASILLA, [], AHORA);

    expect(leerEvento).toHaveBeenCalledTimes(1);
    expect(leerEvento).toHaveBeenCalledWith(CASILLA, "g1");
  });

  it("uno ya divergido no vuelve a marcarse: su divergencia_el es lo que hace reaparecer la alerta", async () => {
    const vieja = "2026-11-02T10:00:00+00:00";
    const base = baseEnMemoria({ agenda_eventos: [evento("1", { divergencia: "borrado", divergencia_el: vieja })] });
    vi.mocked(leerEvento).mockResolvedValue(null);

    expect(await revisarLaCasilla(base.cliente, CASILLA, [], AHORA)).toEqual([]);
    expect(base.tablas.agenda_eventos[0].divergencia_el).toBe(vieja);
  });

  it("si la escritura propia cambió lo escrito mientras se miraba Google, no se marca nada", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    // Google ya trae el horario nuevo; la fila, leída antes, todavía tiene el viejo.
    vi.mocked(leerEvento).mockImplementation(async () => {
      Object.assign(base.tablas.agenda_eventos[0], {
        inicio_escrito: "2026-11-04T13:00:00+00:00",
        fin_escrito: "2026-11-04T14:30:00+00:00",
      });
      return { id: "g1", ...IGUAL, inicio: "2026-11-04T10:00:00-03:00", fin: "2026-11-04T11:30:00-03:00" };
    });

    expect(await revisarLaCasilla(base.cliente, CASILLA, [], AHORA)).toEqual([]);
    expect(base.tablas.agenda_eventos[0].divergencia).toBeNull();
    expect(base.escrituras[0].tocadas).toBe(0);
  });

  it("las dos columnas del par se escriben juntas", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockResolvedValue(null);
    await revisarLaCasilla(base.cliente, CASILLA, [], AHORA);
    expect(Object.keys(base.escrituras[0].columnas).sort()).toEqual(["divergencia", "divergencia_el"]);
  });

  it("un evento que Google no deja leer va a fallos, con lo que dijo, y no corta a los demás", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1"), evento("2")] });
    vi.mocked(leerEvento)
      .mockRejectedValueOnce(new Error("Google está limitando el ritmo de llamadas a Calendar"))
      .mockResolvedValueOnce(null);
    const fallos: string[] = [];

    const r = await revisarLaCasilla(base.cliente, CASILLA, fallos, AHORA);

    expect(r).toEqual([{ evento_id: "2", divergencia: "borrado" }]);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]).toContain(CASILLA);
    expect(fallos[0]).toContain("limitando el ritmo");
  });

  it("si no se pudo anotar la divergencia, va a fallos y no se da por avisada", async () => {
    const base = baseEnMemoria(
      { agenda_eventos: [evento("1")] },
      { falla: { agenda_eventos: { update: "se cayó la base" } } }
    );
    vi.mocked(leerEvento).mockResolvedValue(null);
    const fallos: string[] = [];

    const r = await revisarLaCasilla(base.cliente, CASILLA, fallos, AHORA);

    expect(r).toEqual([]);
    expect(fallos[0]).toContain("se cayó la base");
    expect(fallos[0]).toContain(CASILLA);
  });

  it("tira si no puede ni leer la base: entonces no se miró nada", async () => {
    const base = baseEnMemoria({ agenda_eventos: [] }, { falla: { agenda_eventos: { select: "sin base" } } });
    await expect(revisarLaCasilla(base.cliente, CASILLA, [], AHORA)).rejects.toThrow(/sin base/);
  });
});

// ── ponerAlDiaLosCanales ────────────────────────────────────────────────────

const APP = "https://www.polcecalpolysan.app";
const URL_WEBHOOK = `${APP}/api/agenda/google`;

describe("ponerAlDiaLosCanales", () => {
  it("abre el canal de una casilla que no tiene, con la URL pública y un secreto propio", async () => {
    const base = baseEnMemoria({
      usuarios: [{ id: "u1", email: "ana@polcecal.com", activo: true }],
      agenda_canales: [],
    });
    vi.mocked(abrirCanal).mockResolvedValue({ recursoId: "rec-1", vence: enHoras(24 * 7) });

    const r = await ponerAlDiaLosCanales(base.cliente, APP, AHORA);

    expect(r).toEqual({ abiertos: ["ana@polcecal.com"], renovados: [], fallos: [] });
    const [casilla, canalId, secreto, url] = vi.mocked(abrirCanal).mock.calls[0];
    expect(casilla).toBe("ana@polcecal.com");
    expect(url).toBe(URL_WEBHOOK);
    expect(secreto.length).toBeGreaterThanOrEqual(32);
    expect(base.tablas.agenda_canales[0]).toMatchObject({
      casilla: "ana@polcecal.com", canal_id: canalId, recurso_id: "rec-1", secreto,
    });
  });

  it("no toca a los usuarios desactivados ni a los canales sanos", async () => {
    const base = baseEnMemoria({
      usuarios: [
        { id: "u1", email: "ana@polcecal.com", activo: true },
        { id: "u2", email: "baja@polcecal.com", activo: false },
      ],
      agenda_canales: [{ id: "c1", casilla: "ana@polcecal.com", canal_id: "x", recurso_id: "y", vence: enHoras(24 * 6) }],
    });
    const r = await ponerAlDiaLosCanales(base.cliente, APP, AHORA);
    expect(r).toEqual({ abiertos: [], renovados: [], fallos: [] });
    expect(abrirCanal).not.toHaveBeenCalled();
  });

  it("al renovar abre el nuevo antes de cerrar el viejo, y reemplaza la fila", async () => {
    const base = baseEnMemoria({
      usuarios: [{ id: "u1", email: "ana@polcecal.com", activo: true }],
      agenda_canales: [{ id: "c1", casilla: "ana@polcecal.com", canal_id: "viejo", recurso_id: "rviejo", secreto: "s", vence: enHoras(10) }],
    });
    const orden: string[] = [];
    vi.mocked(abrirCanal).mockImplementation(async () => (orden.push("abrir"), { recursoId: "rnuevo", vence: enHoras(24 * 7) }));
    vi.mocked(cerrarCanal).mockImplementation(async () => void orden.push("cerrar"));

    const r = await ponerAlDiaLosCanales(base.cliente, APP, AHORA);

    expect(r.renovados).toEqual(["ana@polcecal.com"]);
    expect(orden).toEqual(["abrir", "cerrar"]);
    expect(cerrarCanal).toHaveBeenCalledWith("ana@polcecal.com", "viejo", "rviejo");
    expect(base.tablas.agenda_canales).toHaveLength(1);
    expect(base.tablas.agenda_canales[0]).toMatchObject({ recurso_id: "rnuevo" });
    expect(base.tablas.agenda_canales[0].canal_id).not.toBe("viejo");
  });

  it("un canal que no se puede abrir es un fallo que nombra la casilla, y los demás siguen", async () => {
    const base = baseEnMemoria({
      usuarios: [
        { id: "u1", email: "ana@polcecal.com", activo: true },
        { id: "u2", email: "beto@polcecal.com", activo: true },
      ],
      agenda_canales: [],
    });
    vi.mocked(abrirCanal)
      .mockRejectedValueOnce(new Error("Google dijo: WebHook callback channel is not verified"))
      .mockResolvedValueOnce({ recursoId: "r2", vence: enHoras(24 * 7) });

    const r = await ponerAlDiaLosCanales(base.cliente, APP, AHORA);

    expect(r.abiertos).toEqual(["beto@polcecal.com"]);
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toContain("ana@polcecal.com");
    expect(r.fallos[0]).toContain("not verified");
  });

  it("un renovar que falla avisa hasta cuándo dura el canal que queda", async () => {
    const vence = enHoras(10);
    const base = baseEnMemoria({
      usuarios: [{ id: "u1", email: "ana@polcecal.com", activo: true }],
      agenda_canales: [{ id: "c1", casilla: "ana@polcecal.com", canal_id: "viejo", recurso_id: "r", secreto: "s", vence }],
    });
    vi.mocked(abrirCanal).mockRejectedValue(new Error("cuota"));

    const r = await ponerAlDiaLosCanales(base.cliente, APP, AHORA);

    expect(r.renovados).toEqual([]);
    expect(r.fallos[0]).toContain("ana@polcecal.com");
    expect(r.fallos[0]).toContain(vence);
    expect(cerrarCanal).not.toHaveBeenCalled();
  });

  it("si el viejo no se puede cerrar, el nuevo queda en pie y el fallo se informa", async () => {
    const base = baseEnMemoria({
      usuarios: [{ id: "u1", email: "ana@polcecal.com", activo: true }],
      agenda_canales: [{ id: "c1", casilla: "ana@polcecal.com", canal_id: "viejo", recurso_id: "r", secreto: "s", vence: enHoras(10) }],
    });
    vi.mocked(abrirCanal).mockResolvedValue({ recursoId: "rn", vence: enHoras(24 * 7) });
    vi.mocked(cerrarCanal).mockRejectedValue(new Error("channel not found"));

    const r = await ponerAlDiaLosCanales(base.cliente, APP, AHORA);

    expect(r.renovados).toEqual(["ana@polcecal.com"]);
    expect(r.fallos[0]).toContain("ana@polcecal.com");
    expect(r.fallos[0]).toContain("channel not found");
  });

  it("si Google abrió el canal y no se pudo anotar, lo cierra y lo cuenta como fallo", async () => {
    const base = baseEnMemoria(
      { usuarios: [{ id: "u1", email: "ana@polcecal.com", activo: true }], agenda_canales: [] },
      { falla: { agenda_canales: { upsert: "sin escritura" } } }
    );
    vi.mocked(abrirCanal).mockResolvedValue({ recursoId: "rn", vence: enHoras(24 * 7) });

    const r = await ponerAlDiaLosCanales(base.cliente, APP, AHORA);

    expect(r.abiertos).toEqual([]);
    expect(r.fallos[0]).toContain("sin escritura");
    expect(cerrarCanal).toHaveBeenCalledWith("ana@polcecal.com", expect.any(String), "rn");
  });

  it("sin URL pública no abre nada y lo dice una vez, con las casillas que quedaron sin canal", async () => {
    const base = baseEnMemoria({
      usuarios: [
        { id: "u1", email: "ana@polcecal.com", activo: true },
        { id: "u2", email: "beto@polcecal.com", activo: true },
      ],
      agenda_canales: [],
    });

    const r = await ponerAlDiaLosCanales(base.cliente, undefined, AHORA);

    expect(abrirCanal).not.toHaveBeenCalled();
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toContain("NEXT_PUBLIC_APP_URL");
    expect(r.fallos[0]).toContain("ana@polcecal.com");
    expect(r.fallos[0]).toContain("beto@polcecal.com");
  });

  it("sin nada que abrir tampoco hace falta la URL", async () => {
    const base = baseEnMemoria({
      usuarios: [{ id: "u1", email: "ana@polcecal.com", activo: true }],
      agenda_canales: [{ id: "c1", casilla: "ana@polcecal.com", canal_id: "x", recurso_id: "y", vence: enHoras(24 * 6) }],
    });
    expect(await ponerAlDiaLosCanales(base.cliente, undefined, AHORA)).toEqual({ abiertos: [], renovados: [], fallos: [] });
  });
});

// ── barrerLasCasillas ───────────────────────────────────────────────────────

describe("barrerLasCasillas", () => {
  it("revisa a todos los usuarios activos y anota lo que un canal no vio, igual que el webhook", async () => {
    const base = baseEnMemoria({
      usuarios: [
        { id: "u1", email: CASILLA, activo: true },
        { id: "u2", email: "ana@polcecal.com", activo: true },
        { id: "u3", email: "baja@polcecal.com", activo: false },
      ],
      agenda_eventos: [
        evento("1"),
        evento("2", { casilla: "ana@polcecal.com", google_event_id: "g2" }),
        evento("3", { casilla: "baja@polcecal.com", google_event_id: "g3" }),
      ],
    });
    vi.mocked(leerEvento).mockImplementation(async (_c, id) =>
      id === "g2" ? { id, ...IGUAL, inicio: "2026-11-04T10:00:00-03:00", fin: "2026-11-04T11:30:00-03:00" } : { id, ...IGUAL }
    );

    const r = await barrerLasCasillas(base.cliente, AHORA);

    expect(r.casillas).toBe(2);
    expect(r.divergencias).toEqual([{ casilla: "ana@polcecal.com", evento_id: "2", divergencia: "movido" }]);
    expect(r.fallos).toEqual([]);
    // La misma escritura que el webhook: el par entero.
    expect(base.tablas.agenda_eventos[1]).toMatchObject({ divergencia: "movido", divergencia_el: AHORA.toISOString() });
    // Al de un usuario dado de baja no se lo mira.
    expect(leerEvento).not.toHaveBeenCalledWith("baja@polcecal.com", expect.anything());
  });

  it("lo que ya estaba divergido no vuelve a marcarse: el barrido diario no reabre una alerta vista", async () => {
    const vieja = "2026-11-02T10:00:00+00:00";
    const base = baseEnMemoria({
      usuarios: [{ id: "u1", email: CASILLA, activo: true }],
      agenda_eventos: [evento("1", { divergencia: "borrado", divergencia_el: vieja })],
    });
    vi.mocked(leerEvento).mockResolvedValue(null);

    const r = await barrerLasCasillas(base.cliente, AHORA);

    expect(r.divergencias).toEqual([]);
    expect(base.tablas.agenda_eventos[0].divergencia_el).toBe(vieja);
  });

  it("una casilla que falla no corta a las otras, y el fallo la nombra", async () => {
    const base = baseEnMemoria({
      usuarios: [
        { id: "u1", email: CASILLA, activo: true },
        { id: "u2", email: "ana@polcecal.com", activo: true },
      ],
      agenda_eventos: [evento("1"), evento("2", { casilla: "ana@polcecal.com", google_event_id: "g2" })],
    });
    vi.mocked(leerEvento).mockImplementation(async (casilla) => {
      if (casilla === CASILLA) throw new Error("Google respondió 503");
      return null;
    });

    const r = await barrerLasCasillas(base.cliente, AHORA);

    expect(r.divergencias).toEqual([{ casilla: "ana@polcecal.com", evento_id: "2", divergencia: "borrado" }]);
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toContain(CASILLA);
    expect(r.fallos[0]).toContain("503");
  });

  it("si se acaba el tiempo lo dice, con las casillas que no se miraron", async () => {
    const base = baseEnMemoria({
      usuarios: [
        { id: "u1", email: CASILLA, activo: true },
        { id: "u2", email: "ana@polcecal.com", activo: true },
      ],
      agenda_eventos: [],
    });

    const r = await barrerLasCasillas(base.cliente, AHORA, 0);

    expect(r.casillas).toBe(0);
    expect(r.fallos[0]).toContain(CASILLA);
    expect(r.fallos[0]).toContain("ana@polcecal.com");
  });

  it("tira si no puede leer usuarios: no se miró nada", async () => {
    const base = baseEnMemoria({ usuarios: [] }, { falla: { usuarios: { select: "sin base" } } });
    await expect(barrerLasCasillas(base.cliente, AHORA)).rejects.toThrow(/sin base/);
  });
});

// ── El conteo: detectadas contra anotadas ───────────────────────────────────

describe("el conteo de lo detectado contra lo anotado", () => {
  it("lo anotado coincide con lo detectado y no hay nada que decir", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockResolvedValue(null);
    const conteo = conteoVacio();

    await revisarLaCasilla(base.cliente, CASILLA, [], AHORA, conteo);

    expect(conteo).toEqual({ revisadas: 1, detectadas: 1, anotadas: 1, porCarrera: 0, sinExplicar: 0, conError: 0 });
    expect(resumenDelConteo(conteo)).toBeNull();
  });

  it("una carrera legítima se cuenta aparte y no es un fallo", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockImplementation(async () => {
      Object.assign(base.tablas.agenda_eventos[0], {
        inicio_escrito: "2026-11-04T13:00:00+00:00",
        fin_escrito: "2026-11-04T14:30:00+00:00",
      });
      return { id: "g1", ...IGUAL, inicio: "2026-11-04T10:00:00-03:00", fin: "2026-11-04T11:30:00-03:00" };
    });
    const conteo = conteoVacio();
    const fallos: string[] = [];

    await revisarLaCasilla(base.cliente, CASILLA, fallos, AHORA, conteo);

    expect(conteo).toEqual({ revisadas: 1, detectadas: 1, anotadas: 0, porCarrera: 1, sinExplicar: 0, conError: 0 });
    expect(fallos).toEqual([]);
    expect(resumenDelConteo(conteo)).toMatch(/1 divergencias detectadas, 0 anotadas.*carrera legítima/);
    expect(resumenDelConteo(conteo)).not.toMatch(/SIN EXPLICACIÓN/);
  });

  it("si la fila se borró mientras tanto también es una carrera", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockImplementation(async () => {
      base.tablas.agenda_eventos.length = 0;
      return null;
    });
    const conteo = conteoVacio();

    await revisarLaCasilla(base.cliente, CASILLA, [], AHORA, conteo);

    expect(conteo.porCarrera).toBe(1);
    expect(conteo.sinExplicar).toBe(0);
  });

  it("un update que no toca una fila que no cambió es un predicado roto: queda escrito y va a fallos", async () => {
    // El peor fallo posible: nada se anota, la campana queda en cero y todo se ve verde.
    const base = baseEnMemoria(
      { agenda_eventos: [evento("1"), evento("2")] },
      { updateQueNoTocaNada: ["agenda_eventos"] }
    );
    vi.mocked(leerEvento).mockResolvedValue(null);
    const conteo = conteoVacio();
    const fallos: string[] = [];

    const r = await revisarLaCasilla(base.cliente, CASILLA, fallos, AHORA, conteo);

    expect(r).toEqual([]);
    expect(conteo).toEqual({ revisadas: 2, detectadas: 2, anotadas: 0, porCarrera: 0, sinExplicar: 2, conError: 0 });
    expect(fallos).toHaveLength(2);
    expect(fallos[0]).toContain(CASILLA);
    expect(fallos[0]).toMatch(/sin explicación/);
    const resumen = resumenDelConteo(conteo)!;
    expect(resumen).toContain("2 divergencias detectadas, 0 anotadas");
    expect(resumen).toContain("SIN EXPLICACIÓN");
    expect(resumen).toContain("inicio_escrito");
  });

  it("un error de la base al anotar se cuenta como error y no como predicado roto", async () => {
    const base = baseEnMemoria(
      { agenda_eventos: [evento("1")] },
      { falla: { agenda_eventos: { update: "se cayó la base" } } }
    );
    vi.mocked(leerEvento).mockResolvedValue(null);
    const conteo = conteoVacio();

    await revisarLaCasilla(base.cliente, CASILLA, [], AHORA, conteo);

    expect(conteo).toEqual({ revisadas: 1, detectadas: 1, anotadas: 0, porCarrera: 0, sinExplicar: 0, conError: 1 });
    expect(resumenDelConteo(conteo)).toMatch(/error de la base/);
  });

  it("si no se puede ni releer la fila, se cuenta como sin explicación: ante la duda, que se note", async () => {
    const falla: Record<string, { select?: string }> = { agenda_eventos: {} };
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] }, { updateQueNoTocaNada: ["agenda_eventos"], falla });
    // La relectura es un select posterior: la lectura inicial ya salió bien.
    vi.mocked(leerEvento).mockImplementation(async () => {
      falla.agenda_eventos.select = "sin lectura";
      return null;
    });
    const conteo = conteoVacio();
    const fallos: string[] = [];

    await revisarLaCasilla(base.cliente, CASILLA, fallos, AHORA, conteo);

    expect(conteo.sinExplicar).toBe(1);
    expect(fallos[0]).toContain("sin lectura");
  });

  it("el barrido junta el conteo de todas las casillas", async () => {
    const base = baseEnMemoria({
      usuarios: [
        { id: "u1", email: CASILLA, activo: true },
        { id: "u2", email: "ana@polcecal.com", activo: true },
      ],
      agenda_eventos: [evento("1"), evento("2", { casilla: "ana@polcecal.com", google_event_id: "g2" })],
    });
    vi.mocked(leerEvento).mockResolvedValue(null);

    const r = await barrerLasCasillas(base.cliente, AHORA);

    expect(r.conteo).toEqual({ revisadas: 2, detectadas: 2, anotadas: 2, porCarrera: 0, sinExplicar: 0, conError: 0 });
  });

  it("el barrido con el predicado roto lo dice en fallos y en el resumen: 2 detectadas, 0 anotadas", async () => {
    const base = baseEnMemoria(
      {
        usuarios: [{ id: "u1", email: CASILLA, activo: true }],
        agenda_eventos: [evento("1"), evento("2")],
      },
      { updateQueNoTocaNada: ["agenda_eventos"] }
    );
    vi.mocked(leerEvento).mockResolvedValue(null);

    const r = await barrerLasCasillas(base.cliente, AHORA);

    expect(r.divergencias).toEqual([]);
    expect(r.fallos.length).toBeGreaterThan(0);
    expect(resumenDelConteo(r.conteo)).toContain("2 divergencias detectadas, 0 anotadas");
  });
});

// ── El presupuesto único de la corrida ──────────────────────────────────────

describe("el límite de la corrida", () => {
  it("ponerAlDiaLosCanales no empieza ninguna casilla pasado el límite, y las nombra", async () => {
    const base = baseEnMemoria({
      usuarios: [
        { id: "u1", email: "ana@polcecal.com", activo: true },
        { id: "u2", email: "beto@polcecal.com", activo: true },
      ],
      agenda_canales: [],
    });

    const r = await ponerAlDiaLosCanales(base.cliente, APP, AHORA, 0);

    expect(abrirCanal).not.toHaveBeenCalled();
    expect(r.abiertos).toEqual([]);
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toMatch(/cortó por tiempo/);
    expect(r.fallos[0]).toContain("ana@polcecal.com");
    expect(r.fallos[0]).toContain("beto@polcecal.com");
  });

  it("revisarLaCasilla corta entre evento y evento y dice cuántos quedaron sin mirar", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1"), evento("2"), evento("3")] });
    const fallos: string[] = [];

    await revisarLaCasilla(base.cliente, CASILLA, fallos, AHORA, conteoVacio(), 0);

    expect(leerEvento).not.toHaveBeenCalled();
    expect(fallos).toHaveLength(1);
    expect(fallos[0]).toContain(CASILLA);
    expect(fallos[0]).toMatch(/3 eventos sin revisar/);
  });

  it("el barrido le pasa el mismo límite a cada revisión: una casilla larga se corta a la mitad", async () => {
    const base = baseEnMemoria({
      usuarios: [{ id: "u1", email: CASILLA, activo: true }],
      agenda_eventos: [evento("1"), evento("2"), evento("3")],
    });
    let ahoraFalso = 0;
    const reloj = vi.spyOn(Date, "now").mockImplementation(() => ahoraFalso);
    // La primera lectura a Google consume todo el tiempo que había.
    vi.mocked(leerEvento).mockImplementation(async (_c, id) => {
      ahoraFalso = 2000;
      return { id, ...IGUAL };
    });

    try {
      const r = await barrerLasCasillas(base.cliente, AHORA, 1000);
      expect(leerEvento).toHaveBeenCalledTimes(1);
      expect(r.conteo.revisadas).toBe(1);
      expect(r.fallos.some((f) => /2 eventos sin revisar/.test(f))).toBe(true);
    } finally {
      reloj.mockRestore();
    }
  });
});

// ── revisadas: el escalón de más arriba ─────────────────────────────────────

describe("los eventos mirados", () => {
  it("cuenta los eventos que se compararon contra Google, haya o no divergencia", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1"), evento("2")] });
    vi.mocked(leerEvento).mockResolvedValue({ id: "g", ...IGUAL });
    const conteo = conteoVacio();

    await revisarLaCasilla(base.cliente, CASILLA, [], AHORA, conteo);

    expect(conteo.revisadas).toBe(2);
    expect(conteo.detectadas).toBe(0);
  });

  it("un evento que Google no deja leer no cuenta como mirado", async () => {
    const base = baseEnMemoria({ agenda_eventos: [evento("1")] });
    vi.mocked(leerEvento).mockRejectedValue(new Error("503"));
    const conteo = conteoVacio();

    await revisarLaCasilla(base.cliente, CASILLA, [], AHORA, conteo);

    expect(conteo.revisadas).toBe(0);
  });

  it("un barrido de catorce casillas con cero eventos mirados lo dice: no se ve igual que un día sano", async () => {
    const usuarios = Array.from({ length: 14 }, (_, i) => ({ id: `u${i}`, email: `c${i}@polcecal.com`, activo: true }));
    // Hay eventos, pero ninguno que el select devuelva (todos con un fin ya vencido).
    const base = baseEnMemoria({ usuarios, agenda_eventos: [evento("1", { casilla: "c0@polcecal.com", fin: "2020-01-01T00:00:00+00:00" })] });

    const r = await barrerLasCasillas(base.cliente, AHORA);

    expect(r.casillas).toBe(14);
    expect(r.conteo.revisadas).toBe(0);
    expect(lineaDeLosEventosMirados(r.casillas, r.conteo.revisadas)).toMatch(/14 casillas, 0 eventos mirados/);
    expect(resumenDelConteo(r.conteo)).toBeNull(); // el conteo solo no lo ve: por eso existe la línea
  });

  it("no dice nada si miró eventos, ni si no había casillas", () => {
    expect(lineaDeLosEventosMirados(14, 31)).toBeNull();
    expect(lineaDeLosEventosMirados(0, 0)).toBeNull();
  });
});
