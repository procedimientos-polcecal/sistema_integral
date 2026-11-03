import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/core/calendar", () => ({
  abrirCanal: vi.fn(),
  cerrarCanal: vi.fn(),
  leerEvento: vi.fn(),
}));

import { abrirCanal, cerrarCanal, leerEvento } from "@/lib/core/calendar";
import {
  canalesARenovar, tokenValido, urlDelWebhook, revisarLaCasilla, ponerAlDiaLosCanales,
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
