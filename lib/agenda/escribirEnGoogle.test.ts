import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/core/calendar", () => ({
  crearEvento: vi.fn(),
  actualizarEvento: vi.fn(),
  restaurarEvento: vi.fn(),
  borrarEvento: vi.fn(),
  leerEvento: vi.fn(),
}));

import {
  crearEvento, actualizarEvento, restaurarEvento, borrarEvento, leerEvento,
} from "@/lib/core/calendar";
import {
  escribirEnGoogle, columnasDespuesDeEscribir, advertenciaDeLaEscritura, destrabar, parPendiente, parDivergencia, parEscrito, avisoDeUnBorradoFallido, type FilaDivergida,
} from "./escribirEnGoogle";

const EVENTO = {
  id: "0123456789abcdef0123456789abcdef",
  titulo: "Reunión de mantenimiento",
  inicio: "2026-11-03T08:00:00",
  fin: "2026-11-03T09:30:00",
  invitados: ["ana@polcecal.com"],
};

const FILA = {
  casilla: "mantenimiento@polcecal.com",
  google_event_id: null as string | null,
  inicio: "2026-11-03T11:00:00+00:00",
  fin: "2026-11-03T12:30:00+00:00",
};

/** Lo que Google devuelve: con offset, que es lo que hay que guardar. */
const ENGOOGLE = {
  id: EVENTO.id,
  inicio: "2026-11-03T08:00:00-03:00",
  fin: "2026-11-03T09:30:00-03:00",
  cancelado: false,
  titulo: EVENTO.titulo,
  invitados: [{ email: "ana@polcecal.com" }],
};

beforeEach(() => {
  vi.mocked(crearEvento).mockReset();
  vi.mocked(actualizarEvento).mockReset();
  vi.mocked(restaurarEvento).mockReset();
  vi.mocked(borrarEvento).mockReset();
  vi.mocked(leerEvento).mockReset();
});

describe("escribirEnGoogle — crear", () => {
  it("al crear devuelve el id de Google y lo que se escribió", async () => {
    vi.mocked(crearEvento).mockResolvedValue(ENGOOGLE);
    const r = await escribirEnGoogle("crear", FILA, EVENTO);
    expect(r).toEqual({
      google_event_id: EVENTO.id,
      inicio_escrito: "2026-11-03T08:00:00-03:00",
      fin_escrito: "2026-11-03T09:30:00-03:00",
    });
  });

  it("lo escrito es lo que Google devolvió y no lo que se mandó", async () => {
    // Se manda sin offset y vuelve con offset: guardar lo mandado haría que el
    // eco de la propia escritura saliera como un cambio de otra persona.
    vi.mocked(crearEvento).mockResolvedValue(ENGOOGLE);
    const r = await escribirEnGoogle("crear", FILA, EVENTO);
    expect(r.inicio_escrito).not.toBe(EVENTO.inicio);
    expect(r.inicio_escrito).toBe(ENGOOGLE.inicio);
  });

  it("crea con el id propio, que es lo que lo hace reintentable", async () => {
    vi.mocked(crearEvento).mockResolvedValue(ENGOOGLE);
    await escribirEnGoogle("crear", FILA, EVENTO);
    expect(vi.mocked(crearEvento).mock.calls[0][1].id).toBe(EVENTO.id);
  });

  it("un fallo de Google vuelve como pendiente con el texto de Google sin traducir", async () => {
    vi.mocked(crearEvento).mockRejectedValue(
      new Error("Google no dio acceso al calendario. Google dijo: Forbidden For Non Organizer")
    );
    const r = await escribirEnGoogle("crear", FILA, EVENTO);
    expect(r.pendiente).toContain("Google dijo: Forbidden For Non Organizer");
    expect(r.pendiente).not.toMatch(/no se pudo guardar/i);
  });

  it("un fallo no deja inicio_escrito a medias", async () => {
    vi.mocked(crearEvento).mockRejectedValue(new Error("Google OAuth: unauthorized_client"));
    const r = await escribirEnGoogle("crear", FILA, EVENTO);
    expect(r).not.toHaveProperty("inicio_escrito");
    expect(r).not.toHaveProperty("fin_escrito");
    expect(r).not.toHaveProperty("google_event_id");
  });

  it("un fallo no tira: lo que no es un Error también vuelve como pendiente", async () => {
    vi.mocked(crearEvento).mockRejectedValue("se cayó la red");
    await expect(escribirEnGoogle("crear", FILA, EVENTO)).resolves.toEqual({ pendiente: "se cayó la red" });
  });

  describe("crear cuando el id ya existía vivo (`yaEstaba`)", () => {
    // `crearEvento` ante un 409 devuelve el evento que había SIN aplicarle el
    // cuerpo nuevo y lo marca `yaEstaba`. Darlo por bueno dejaba la fila y
    // Google distintos para siempre: `inicio_escrito` con lo viejo de Google,
    // sin divergencia y sin pendiente.
    const yaEstaba = {
      ...ENGOOGLE,
      inicio: "2026-11-03T07:00:00-03:00",
      fin: "2026-11-03T08:30:00-03:00",
      yaEstaba: true as const,
    };

    it("pisa con el PUT y anota lo que devolvió el PUT, no lo viejo", async () => {
      vi.mocked(crearEvento).mockResolvedValue(yaEstaba);
      vi.mocked(restaurarEvento).mockResolvedValue(ENGOOGLE);
      const r = await escribirEnGoogle("crear", FILA, EVENTO);
      expect(restaurarEvento).toHaveBeenCalledOnce();
      expect(r.inicio_escrito).toBe(ENGOOGLE.inicio);
      expect(r.inicio_escrito).not.toBe("2026-11-03T07:00:00-03:00");
    });

    it("pisa aunque se vea idéntico: lo que no se ve (descripción, lugar) puede haber cambiado", async () => {
      // El caso que una comparación incompleta daba por bueno: horario, título e
      // invitados iguales, y sólo cambió la descripción.
      vi.mocked(crearEvento).mockResolvedValue({ ...ENGOOGLE, yaEstaba: true });
      vi.mocked(restaurarEvento).mockResolvedValue(ENGOOGLE);
      await escribirEnGoogle("crear", FILA, { ...EVENTO, descripcion: "La nueva" });
      expect(restaurarEvento).toHaveBeenCalledOnce();
      expect(vi.mocked(restaurarEvento).mock.calls[0][2].descripcion).toBe("La nueva");
    });

    it("un alta nueva no paga el PUT ni manda un segundo aviso", async () => {
      vi.mocked(crearEvento).mockResolvedValue(ENGOOGLE);
      await escribirEnGoogle("crear", FILA, EVENTO);
      expect(restaurarEvento).not.toHaveBeenCalled();
    });

    it("si el PUT falla por excepción vuelve el pendiente con lo que dijo Google y con el id de Google", async () => {
      vi.mocked(crearEvento).mockResolvedValue(yaEstaba);
      vi.mocked(restaurarEvento).mockRejectedValue(new Error("Google dijo: 500"));
      const r = await escribirEnGoogle("crear", FILA, EVENTO);
      expect(r.pendiente).toContain("Google dijo: 500");
      expect(r.google_event_id).toBe(EVENTO.id);
      expect(r).not.toHaveProperty("inicio_escrito");
    });

    it("el otro fallo del PUT, el del cancelado, también devuelve el id de Google", async () => {
      vi.mocked(crearEvento).mockResolvedValue(yaEstaba);
      vi.mocked(restaurarEvento).mockResolvedValue({ ...ENGOOGLE, cancelado: true });
      const r = await escribirEnGoogle("crear", FILA, EVENTO);
      expect(r.pendiente).toMatch(/cancelado/);
      expect(r.google_event_id).toBe(EVENTO.id);
    });

    it("si el crear falla no sigue con el PUT", async () => {
      vi.mocked(crearEvento).mockRejectedValue(new Error("Google dijo: 403"));
      const r = await escribirEnGoogle("crear", FILA, EVENTO);
      expect(r.pendiente).toContain("403");
      expect(restaurarEvento).not.toHaveBeenCalled();
    });
  });

  it("si el id ya estaba y Google lo tiene borrado, lo restaura", async () => {
    // Google reserva el id también de un evento borrado: el 409 de un reintento
    // trae uno cancelado, y lo que se pidió es un evento vivo.
    vi.mocked(crearEvento).mockResolvedValue({ ...ENGOOGLE, cancelado: true });
    vi.mocked(restaurarEvento).mockResolvedValue(ENGOOGLE);
    const r = await escribirEnGoogle("crear", FILA, EVENTO);
    expect(restaurarEvento).toHaveBeenCalledOnce();
    expect(r.inicio_escrito).toBe(ENGOOGLE.inicio);
  });

  it("una respuesta sin horario no anota la mitad: es un pendiente", async () => {
    vi.mocked(crearEvento).mockResolvedValue({ ...ENGOOGLE, inicio: "" });
    const r = await escribirEnGoogle("crear", FILA, EVENTO);
    expect(r.pendiente).toMatch(/sin horario/);
    expect(r).not.toHaveProperty("inicio_escrito");
    expect(r).not.toHaveProperty("fin_escrito");
  });
});

describe("escribirEnGoogle — actualizar, restaurar y borrar", () => {
  const conId = { ...FILA, google_event_id: EVENTO.id };

  it("actualizar anota lo que Google devolvió", async () => {
    vi.mocked(actualizarEvento).mockResolvedValue({ ...ENGOOGLE, inicio: "2026-11-03T09:00:00-03:00" });
    const r = await escribirEnGoogle("actualizar", conId, EVENTO);
    expect(r.inicio_escrito).toBe("2026-11-03T09:00:00-03:00");
  });

  it("actualizar sobre un evento borrado no es una escritura: es una divergencia", async () => {
    // El PATCH sobre un borrado contesta 200 y lo deja cancelado (medido).
    vi.mocked(actualizarEvento).mockResolvedValue({ ...ENGOOGLE, cancelado: true });
    const r = await escribirEnGoogle("actualizar", conId, EVENTO);
    expect(r.divergencia).toBe("borrado");
    expect(r).not.toHaveProperty("inicio_escrito");
    expect(r.pendiente).toBeUndefined();
  });

  it("actualizar sin id en Google no llama a Google", async () => {
    const r = await escribirEnGoogle("actualizar", FILA, EVENTO);
    expect(r.pendiente).toBeTruthy();
    expect(actualizarEvento).not.toHaveBeenCalled();
  });

  it("restaurar usa el PUT y anota lo escrito", async () => {
    vi.mocked(restaurarEvento).mockResolvedValue(ENGOOGLE);
    const r = await escribirEnGoogle("restaurar", conId, EVENTO);
    expect(restaurarEvento).toHaveBeenCalledOnce();
    expect(actualizarEvento).not.toHaveBeenCalled();
    expect(r.inicio_escrito).toBe(ENGOOGLE.inicio);
  });

  it("restaurar que Google devuelve cancelado es un fallo, no un éxito", async () => {
    vi.mocked(restaurarEvento).mockResolvedValue({ ...ENGOOGLE, cancelado: true });
    const r = await escribirEnGoogle("restaurar", conId, EVENTO);
    expect(r.pendiente).toMatch(/cancelado/);
    expect(r).not.toHaveProperty("inicio_escrito");
  });

  it("borrar no devuelve nada que anotar y un fallo vuelve como pendiente", async () => {
    vi.mocked(borrarEvento).mockResolvedValueOnce(undefined);
    await expect(escribirEnGoogle("borrar", conId)).resolves.toEqual({});

    vi.mocked(borrarEvento).mockRejectedValueOnce(new Error("Google dijo: 500 backendError"));
    const r = await escribirEnGoogle("borrar", conId);
    expect(r.pendiente).toContain("backendError");
  });
});

describe("columnasDespuesDeEscribir", () => {
  const ahora = "2026-11-02T15:00:00.000Z";

  it("una escritura buena anota lo escrito y limpia el pendiente, los dos del par", () => {
    const c = columnasDespuesDeEscribir(
      { google_event_id: "abc", inicio_escrito: ENGOOGLE.inicio, fin_escrito: ENGOOGLE.fin },
      ahora
    );
    expect(c).toMatchObject({
      google_event_id: "abc",
      inicio_escrito: ENGOOGLE.inicio,
      fin_escrito: ENGOOGLE.fin,
      google_pendiente: null,
      google_pendiente_el: null,
    });
  });

  it("un fallo anota el pendiente con su fecha y no toca lo escrito", () => {
    const c = columnasDespuesDeEscribir({ pendiente: "Google dijo: 403" }, ahora);
    expect(c).toEqual({ google_pendiente: "Google dijo: 403", google_pendiente_el: ahora });
  });

  it("una divergencia anota los dos del par y limpia el pendiente", () => {
    const c = columnasDespuesDeEscribir({ google_event_id: "abc", divergencia: "borrado" }, ahora);
    expect(c.divergencia).toBe("borrado");
    expect(c.divergencia_el).toBe(ahora);
    expect(c.google_pendiente).toBeNull();
    expect(c.google_pendiente_el).toBeNull();
    expect(c).not.toHaveProperty("inicio_escrito");
  });

  it("nunca deja un par a medias", () => {
    const casos = [
      { pendiente: "x" },
      { divergencia: "movido" as const },
      { inicio_escrito: ENGOOGLE.inicio, fin_escrito: ENGOOGLE.fin },
      {},
    ];
    for (const r of casos) {
      const c = columnasDespuesDeEscribir(r, ahora);
      for (const [a, b] of [["google_pendiente", "google_pendiente_el"], ["divergencia", "divergencia_el"]]) {
        if (a in c || b in c) expect(c[a] === null).toBe(c[b] === null);
      }
    }
  });
});

describe("los tres pares atados por un check", () => {
  const ahora = "2026-11-02T15:00:00.000Z";
  const PARES = [
    ["google_pendiente", "google_pendiente_el"],
    ["divergencia", "divergencia_el"],
    ["inicio_escrito", "fin_escrito"],
  ];
  /** Lo que la base exige: de cada par, las dos columnas en null o las dos con valor. */
  function paresEnOrden(c: Record<string, unknown>) {
    for (const [a, b] of PARES) {
      if (!(a in c) && !(b in c)) continue;
      expect(a in c && b in c, `${a}/${b} no van juntas`).toBe(true);
      expect(c[a] === null, `${a}/${b} no están las dos en null o las dos con valor`).toBe(c[b] === null);
    }
  }

  it("parPendiente, parDivergencia y parEscrito escriben el par entero", () => {
    paresEnOrden(parPendiente("Google dijo: 403", ahora));
    paresEnOrden(parPendiente(null, ahora));
    paresEnOrden(parDivergencia("movido", ahora));
    paresEnOrden(parDivergencia(null, ahora));
    paresEnOrden(parEscrito("a", "b"));
  });

  it("un pendiente vacío no se pierde: se anota con un texto", () => {
    expect(parPendiente("", ahora)).toEqual({
      google_pendiente: "Google falló sin dar un mensaje",
      google_pendiente_el: ahora,
    });
  });

  it("anotar sólo un lado de lo escrito no escribe ninguno", () => {
    expect(parEscrito("a", undefined)).toEqual({});
    expect(parEscrito(undefined, "b")).toEqual({});
    expect(parEscrito("", "b")).toEqual({});
  });

  it("un error de Google sin mensaje igual vuelve como pendiente", async () => {
    vi.mocked(crearEvento).mockRejectedValue(new Error(""));
    const r = await escribirEnGoogle("crear", FILA, EVENTO);
    expect(r.pendiente).toBeTruthy();
    expect(columnasDespuesDeEscribir(r, ahora).google_pendiente_el).toBe(ahora);
  });

  it("ninguna combinación de resultado deja un par a medias", () => {
    const resultados = [
      {},
      { pendiente: "x" },
      { pendiente: "" },
      { divergencia: "borrado" as const },
      { inicio_escrito: "a", fin_escrito: "b" },
      { inicio_escrito: "a" },
      { fin_escrito: "b" },
      { google_event_id: "g", inicio_escrito: "a", fin_escrito: "b" },
    ];
    for (const r of resultados) paresEnOrden(columnasDespuesDeEscribir(r, ahora));
  });

  it("destrabar deja los tres pares enteros, en los dos caminos", async () => {
    const fila: FilaDivergida = { ...FILA, google_event_id: EVENTO.id, divergencia: "movido" };
    vi.mocked(actualizarEvento).mockResolvedValue(ENGOOGLE);
    const a = await destrabar("reescribir", fila, EVENTO);
    vi.mocked(leerEvento).mockResolvedValue(ENGOOGLE);
    const b = await destrabar("aceptar", fila, EVENTO);
    vi.mocked(actualizarEvento).mockRejectedValue(new Error("Google dijo: 500"));
    const c = await destrabar("reescribir", fila, EVENTO);
    for (const r of [a, b, c]) {
      const columnas = r.ok ? r.columnas : r.columnas;
      expect(columnas).toBeDefined();
      paresEnOrden(columnas!);
    }
  });
});

describe("advertenciaDeLaEscritura", () => {
  it("si quedó pendiente lo dice, con lo que dijo Google", () => {
    const a = advertenciaDeLaEscritura({ pendiente: "Google dijo: 503 backendError" }, "El evento");
    expect(a).toMatch(/no llegó a Google/);
    expect(a).toContain("503 backendError");
  });
  it("si el evento estaba borrado dice que sigue invisible", () => {
    expect(advertenciaDeLaEscritura({ divergencia: "borrado" }, "El cambio")).toMatch(/invisible/);
  });
  it("si salió bien no dice nada", () => {
    expect(advertenciaDeLaEscritura({ inicio_escrito: "a", fin_escrito: "b" }, "El evento")).toBeNull();
  });
});

describe("destrabar", () => {
  const movida: FilaDivergida = { ...FILA, google_event_id: EVENTO.id, divergencia: "movido" };
  const borrada: FilaDivergida = { ...movida, divergencia: "borrado" };

  it("destrabar reescribiendo deja lo del SdG y limpia la divergencia", async () => {
    vi.mocked(actualizarEvento).mockResolvedValue(ENGOOGLE);
    const r = await destrabar("reescribir", movida, EVENTO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.columnas).toMatchObject({
      divergencia: null,
      divergencia_el: null,
      google_pendiente: null,
      google_pendiente_el: null,
      inicio_escrito: ENGOOGLE.inicio,
      fin_escrito: ENGOOGLE.fin,
    });
    // `inicio`/`fin` son lo del SdG y no se tocan.
    expect(r.columnas).not.toHaveProperty("inicio");
    expect(r.columnas).not.toHaveProperty("fin");
  });

  it("reescribir sobre un borrado usa restaurarEvento y nunca actualizarEvento", async () => {
    // El PATCH sobre un borrado dice que funcionó y deja el evento invisible.
    vi.mocked(restaurarEvento).mockResolvedValue(ENGOOGLE);
    const r = await destrabar("reescribir", borrada, EVENTO);
    expect(r.ok).toBe(true);
    expect(restaurarEvento).toHaveBeenCalledOnce();
    expect(actualizarEvento).not.toHaveBeenCalled();
  });

  it("reescribir un movido que mientras tanto lo borraron lo restaura", async () => {
    vi.mocked(actualizarEvento).mockResolvedValue({ ...ENGOOGLE, cancelado: true });
    vi.mocked(restaurarEvento).mockResolvedValue(ENGOOGLE);
    const r = await destrabar("reescribir", movida, EVENTO);
    expect(r.ok).toBe(true);
    expect(restaurarEvento).toHaveBeenCalledOnce();
  });

  it("si la reescritura falla no destraba y guarda lo que dijo Google", async () => {
    vi.mocked(restaurarEvento).mockRejectedValue(new Error("Google dijo: 403 forbiddenForNonOrganizer"));
    const r = await destrabar("reescribir", borrada, EVENTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.estado).toBe(502);
    expect(r.error).toContain("forbiddenForNonOrganizer");
    expect(r.columnas?.google_pendiente).toContain("forbiddenForNonOrganizer");
    expect(r.columnas).not.toHaveProperty("divergencia");
  });

  it("destrabar aceptando trae lo de Google a la fila", async () => {
    vi.mocked(leerEvento).mockResolvedValue({
      ...ENGOOGLE,
      inicio: "2026-11-03T10:00:00-03:00",
      fin: "2026-11-03T11:30:00-03:00",
    });
    const r = await destrabar("aceptar", movida, EVENTO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.columnas).toMatchObject({
      inicio: "2026-11-03T10:00:00-03:00",
      fin: "2026-11-03T11:30:00-03:00",
      inicio_escrito: "2026-11-03T10:00:00-03:00",
      fin_escrito: "2026-11-03T11:30:00-03:00",
      divergencia: null,
      divergencia_el: null,
    });
  });

  it("aceptar un borrado no se puede: no hay horario que traer", async () => {
    const r = await destrabar("aceptar", borrada, EVENTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.estado).toBe(409);
    expect(leerEvento).not.toHaveBeenCalled();
  });

  it("aceptar no escribe en Google", async () => {
    vi.mocked(leerEvento).mockResolvedValue(ENGOOGLE);
    await destrabar("aceptar", movida, EVENTO);
    expect(actualizarEvento).not.toHaveBeenCalled();
    expect(restaurarEvento).not.toHaveBeenCalled();
    expect(crearEvento).not.toHaveBeenCalled();
  });

  it("aceptar un evento que Google convirtió en día completo se rechaza", async () => {
    vi.mocked(leerEvento).mockResolvedValue({ ...ENGOOGLE, inicio: "2026-11-03", fin: "2026-11-04" });
    const r = await destrabar("aceptar", movida, EVENTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/sin hora precisa/);
  });

  it("aceptar si Google lo borró mientras tanto se rechaza", async () => {
    vi.mocked(leerEvento).mockResolvedValue({ ...ENGOOGLE, cancelado: true });
    const r = await destrabar("aceptar", movida, EVENTO);
    expect(r.ok).toBe(false);
  });

  it("un fallo al leer de Google es un 502 con lo que dijo Google", async () => {
    vi.mocked(leerEvento).mockRejectedValue(new Error("Google dijo: 503"));
    const r = await destrabar("aceptar", movida, EVENTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.estado).toBe(502);
    expect(r.error).toContain("Google dijo: 503");
  });
});

describe("avisoDeUnBorradoFallido", () => {
  it("lleva lo que dijo Google sin traducir y dice que el evento sigue vivo", () => {
    const a = avisoDeUnBorradoFallido("Google respondió 503");
    expect(a).toContain("Google respondió 503");
    expect(a).toMatch(/sigue vivo/);
  });

  it("nunca queda vacío", () => {
    expect(avisoDeUnBorradoFallido("")).toMatch(/Google falló sin dar un mensaje/);
  });
});
