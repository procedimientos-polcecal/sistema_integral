import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google")>()),
  obtenerToken: vi.fn(async () => "token-de-prueba"),
}));

import { obtenerToken } from "./google";
import {
  ZONA_ARGENTINA, crearEvento, leerEvento, actualizarEvento, restaurarEvento, borrarEvento, abrirCanal, cerrarCanal,
} from "./calendar";

/**
 * El `fetch` va mockeado: no se llama a Google. Los formatos de respuesta son los
 * medidos el 02/11/2026 (ver el encabezado de calendar.ts).
 */
const fetchMock = vi.fn();

function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

/** El pedido `n` que llegó al fetch: url, método y cuerpo ya parseado. */
function pedido(n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { url, init, metodo: init.method ?? "GET", cuerpo: init.body ? JSON.parse(String(init.body)) : undefined };
}

const EVENTO: Parameters<typeof crearEvento>[1] = {
  titulo: "OT 2901 — Mantenimiento",
  descripcion: "Cambio de rodamientos",
  lugar: "Filler 1",
  inicio: "2026-11-03T08:00:00",
  fin: "2026-11-03T12:00:00",
  invitados: ["ana@polcecal.com", "luis@polcecal.com"],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(obtenerToken).mockClear();
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "sdg@proyecto.iam.gserviceaccount.com" });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

describe("crearEvento", () => {
  it("manda la zona explícita en inicio y en fin", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "e1", status: "confirmed" }));
    await crearEvento("ana@polcecal.com", EVENTO, "all");

    const { cuerpo } = pedido();
    // Nueve de catorce calendarios están en UTC: sin esto el evento corre de hora.
    expect(cuerpo.start).toEqual({ dateTime: "2026-11-03T08:00:00", timeZone: ZONA_ARGENTINA });
    expect(cuerpo.end).toEqual({ dateTime: "2026-11-03T12:00:00", timeZone: ZONA_ARGENTINA });
  });

  it("pide el token de la casilla, avisa a los invitados y manda los campos de Google", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "e1" }));
    await crearEvento("ana@polcecal.com", EVENTO, "all");

    expect(obtenerToken).toHaveBeenCalledWith(["https://www.googleapis.com/auth/calendar"], "ana@polcecal.com");
    const { url, metodo, cuerpo, init } = pedido();
    expect(metodo).toBe("POST");
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-de-prueba");
    expect(cuerpo.summary).toBe("OT 2901 — Mantenimiento");
    expect(cuerpo.description).toBe("Cambio de rodamientos");
    expect(cuerpo.location).toBe("Filler 1");
    expect(cuerpo.attendees).toEqual([{ email: "ana@polcecal.com" }, { email: "luis@polcecal.com" }]);
  });

  it("con «none» crea sin mandar la invitación, y con los mismos invitados", async () => {
    // Es lo que hace que una OT entre al calendario de las cinco casillas sin
    // mandar cuatro correos. Los `attendees` se comprueban acá a propósito: lo
    // que se apaga es el aviso, no la invitación, y un cambio que además
    // vaciara la lista pasaría desapercibido mirando sólo la URL.
    fetchMock.mockResolvedValue(json(200, { id: "e1" }));
    await crearEvento("ana@polcecal.com", EVENTO, "none");
    const { url, cuerpo } = pedido();
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none");
    expect(cuerpo.attendees).toEqual([{ email: "ana@polcecal.com" }, { email: "luis@polcecal.com" }]);
  });

  it("devuelve el evento recortado, con el offset que puso Google y las respuestas", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        id: "e1",
        status: "confirmed",
        summary: "OT 2901",
        start: { dateTime: "2026-11-03T08:00:00-03:00", timeZone: ZONA_ARGENTINA },
        end: { dateTime: "2026-11-03T12:00:00-03:00", timeZone: ZONA_ARGENTINA },
        attendees: [
          { email: "ana@polcecal.com", responseStatus: "accepted" },
          { email: "luis@polcecal.com", responseStatus: "needsAction" },
        ],
      })
    );
    expect(await crearEvento("ana@polcecal.com", EVENTO, "all")).toEqual({
      id: "e1",
      inicio: "2026-11-03T08:00:00-03:00",
      fin: "2026-11-03T12:00:00-03:00",
      cancelado: false,
      titulo: "OT 2901",
      invitados: [
        { email: "ana@polcecal.com", respuesta: "accepted" },
        { email: "luis@polcecal.com", respuesta: "needsAction" },
      ],
    });
  });
});

describe("crearEvento con id propio", () => {
  const ID = "0123456789abcdef0123456789abcdef";

  it("manda el id elegido por el SdG", async () => {
    fetchMock.mockResolvedValue(json(200, { id: ID }));
    await crearEvento("ana@polcecal.com", { ...EVENTO, id: ID }, "all");
    expect(pedido().cuerpo.id).toBe(ID);
  });

  it("un alta nueva no viene marcada como «ya estaba»", async () => {
    fetchMock.mockResolvedValue(json(200, { id: ID, status: "confirmed" }));
    const evento = await crearEvento("ana@polcecal.com", { ...EVENTO, id: ID }, "all");
    expect(evento.yaEstaba).toBeUndefined();
  });

  it("sin id no manda ninguno", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "e1" }));
    await crearEvento("ana@polcecal.com", EVENTO, "all");
    expect("id" in pedido().cuerpo).toBe(false);
  });

  it("un 409 es que el intento anterior sí entró: devuelve el evento leyéndolo", async () => {
    fetchMock
      .mockResolvedValueOnce(json(409, { error: { code: 409, message: "The requested identifier already exists." } }))
      .mockResolvedValueOnce(json(200, { id: ID, status: "confirmed", summary: "OT 2901" }));
    const evento = await crearEvento("ana@polcecal.com", { ...EVENTO, id: ID }, "all");

    expect(evento.id).toBe(ID);
    expect(evento.cancelado).toBe(false);
    // Lo que distingue «ya estaba» de un alta nueva: el cuerpo pedido NO se aplicó.
    expect(evento.yaEstaba).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pedido(1).metodo).toBe("GET");
    expect(pedido(1).url).toBe(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${ID}`);
  });

  it("un 409 sin id propio se propaga: no hay nada que releer", async () => {
    fetchMock.mockResolvedValue(json(409, { error: { message: "Conflict" } }));
    await expect(crearEvento("ana@polcecal.com", EVENTO, "all")).rejects.toThrow("Conflict");
  });

  it("un id fuera de base32hex se rechaza antes de llamar a Google", async () => {
    for (const id of ["ABCDE12345", "con-guiones-123", "abcd", "wxyz1234"]) {
      await expect(crearEvento("ana@polcecal.com", { ...EVENTO, id }, "all")).rejects.toThrow("base32hex");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("leerEvento", () => {
  it("un evento cancelado se lee como cancelado y no como ausente", async () => {
    // Medido: el GET de un evento borrado es un 200, no un 404.
    fetchMock.mockResolvedValue(json(200, { id: "e1", status: "cancelled" }));
    const evento = await leerEvento("ana@polcecal.com", "e1");
    expect(evento).not.toBeNull();
    expect(evento?.cancelado).toBe(true);
    expect(evento?.invitados).toEqual([]);
  });

  it("un evento vivo no está cancelado", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "e1", status: "confirmed" }));
    expect((await leerEvento("ana@polcecal.com", "e1"))?.cancelado).toBe(false);
  });

  it("un 404 se lee como null", async () => {
    fetchMock.mockResolvedValue(json(404, { error: { code: 404, message: "Not Found" } }));
    expect(await leerEvento("ana@polcecal.com", "nunca-existio")).toBeNull();
  });

  it("un 403 llega con el mensaje de Google y nombrando la cuenta de servicio", async () => {
    fetchMock.mockResolvedValue(json(403, { error: { code: 403, message: "Forbidden for domain delegation" } }));
    const e = await leerEvento("ana@polcecal.com", "e1").catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toContain("Forbidden for domain delegation");
    expect((e as Error).message).toContain("sdg@proyecto.iam.gserviceaccount.com");
  });

  it("un 403 manda a la delegación de dominio y no a una carpeta compartida", async () => {
    fetchMock.mockResolvedValue(json(403, { error: { code: 403, message: "Forbidden for domain delegation" } }));
    const e = (await leerEvento("ana@polcecal.com", "e1").catch((x: Error) => x)) as Error;
    expect(e.message).toContain("delegación de todo el dominio");
    expect(e.message).toContain("101499089090401417948");
    expect(e.message).not.toContain("carpeta");
  });

  it("un 403 de cuota dice que Google está limitando y no habla de delegación", async () => {
    for (const reason of ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]) {
      fetchMock.mockResolvedValue(json(403, { error: { code: 403, message: "Rate Limit Exceeded", errors: [{ reason }] } }));
      const e = (await leerEvento("ana@polcecal.com", "e1").catch((x: Error) => x)) as Error;
      expect(e.message).toContain("limitando");
      expect(e.message).toContain("Rate Limit Exceeded");
      expect(e.message).not.toContain("delegación");
    }
  });

  it("un 403 forbiddenForNonOrganizer dice que el evento es de otra persona", async () => {
    fetchMock.mockResolvedValue(
      json(403, { error: { code: 403, message: "Only the organizer can do that", errors: [{ reason: "forbiddenForNonOrganizer" }] } })
    );
    const e = (await actualizarEvento("ana@polcecal.com", "e1", { titulo: "x" }, "all").catch((x: Error) => x)) as Error;
    expect(e.message).toContain("organiza otra persona");
    expect(e.message).toContain("Only the organizer can do that");
    expect(e.message).not.toContain("delegación");
  });

  it("un 403 por la API sin habilitar conserva su explicación propia", async () => {
    fetchMock.mockResolvedValue(
      json(403, {
        error: {
          code: 403,
          message: "Google Calendar API has not been used",
          details: [{ reason: "SERVICE_DISABLED", metadata: { serviceTitle: "Google Calendar API", activationUrl: "https://console.cloud.google.com/x" } }],
        },
      })
    );
    const e = (await leerEvento("ana@polcecal.com", "e1").catch((x: Error) => x)) as Error;
    expect(e.message).toContain("no está habilitada");
    expect(e.message).toContain("https://console.cloud.google.com/x");
    expect(e.message).not.toContain("delegación");
  });
});

describe("actualizarEvento", () => {
  it("parcha sólo lo que se pasa, con la zona si cambia la hora", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "e1" }));
    await actualizarEvento("ana@polcecal.com", "e1", { inicio: "2026-11-04T08:00:00", fin: "2026-11-04T12:00:00" }, "all");

    const { url, metodo, cuerpo } = pedido();
    expect(metodo).toBe("PATCH");
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/e1?sendUpdates=all");
    expect(Object.keys(cuerpo).sort()).toEqual(["end", "start"]);
    expect(cuerpo.start.timeZone).toBe(ZONA_ARGENTINA);
    expect(cuerpo.end.timeZone).toBe(ZONA_ARGENTINA);
  });

  it("un 403 se propaga con lo que dijo Google", async () => {
    fetchMock.mockResolvedValue(json(403, { error: { message: "Not a delegate" } }));
    await expect(actualizarEvento("ana@polcecal.com", "e1", { titulo: "x" }, "all")).rejects.toThrow("Not a delegate");
  });
});

describe("restaurarEvento", () => {
  it("resucita con PUT, el cuerpo completo y status confirmed", async () => {
    // Medido el 02/11/2026: un PATCH sobre un borrado da 200 y sigue cancelled.
    fetchMock.mockResolvedValue(json(200, { id: "e1", status: "confirmed" }));
    const evento = await restaurarEvento("ana@polcecal.com", "e1", EVENTO, "all");

    const { url, metodo, cuerpo } = pedido();
    expect(metodo).toBe("PUT");
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/e1?sendUpdates=all");
    expect(cuerpo.status).toBe("confirmed");
    expect(cuerpo.summary).toBe("OT 2901 — Mantenimiento");
    expect(cuerpo.start).toEqual({ dateTime: "2026-11-03T08:00:00", timeZone: ZONA_ARGENTINA });
    expect(cuerpo.end).toEqual({ dateTime: "2026-11-03T12:00:00", timeZone: ZONA_ARGENTINA });
    expect(cuerpo.attendees).toHaveLength(2);
    expect(evento.cancelado).toBe(false);
  });

  it("un fallo se propaga con lo que dijo Google", async () => {
    fetchMock.mockResolvedValue(json(500, { error: { message: "Backend Error" } }));
    await expect(restaurarEvento("ana@polcecal.com", "e1", EVENTO, "all")).rejects.toThrow("Backend Error");
  });
});

describe("borrarEvento", () => {
  it("borra avisando a los invitados", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await borrarEvento("ana@polcecal.com", "e1", "all");
    const { url, metodo } = pedido();
    expect(metodo).toBe("DELETE");
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/e1?sendUpdates=all");
  });

  it("con «none» borra sin mandarle la cancelación a nadie", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await borrarEvento("ana@polcecal.com", "e1", "none");
    expect(pedido().url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/e1?sendUpdates=none"
    );
  });

  it("uno ya borrado (410) no es un error", async () => {
    fetchMock.mockResolvedValue(json(410, { error: { code: 410, message: "Resource has been deleted" } }));
    await expect(borrarEvento("ana@polcecal.com", "e1", "all")).resolves.toBeUndefined();
  });

  it("uno que Google no conoce (404) tampoco: ya no está, que es lo que se quería", async () => {
    fetchMock.mockResolvedValue(json(404, { error: { code: 404, message: "Not Found" } }));
    await expect(borrarEvento("ana@polcecal.com", "e1", "all")).resolves.toBeUndefined();
  });

  it("otro fallo se propaga", async () => {
    fetchMock.mockResolvedValue(json(500, { error: { message: "Backend Error" } }));
    await expect(borrarEvento("ana@polcecal.com", "e1", "all")).rejects.toThrow("Backend Error");
  });
});

describe("canales", () => {
  it("abrirCanal manda el secreto y la url, y devuelve el vencimiento en ISO", async () => {
    fetchMock.mockResolvedValue(json(200, { resourceId: "recurso-1", expiration: "1893456000000" }));
    const r = await abrirCanal("ana@polcecal.com", "canal-1", "secreto", "https://sdg.example/api/agenda/aviso");

    const { url, metodo, cuerpo } = pedido();
    expect(metodo).toBe("POST");
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/watch");
    expect(cuerpo).toEqual({
      id: "canal-1", type: "web_hook", address: "https://sdg.example/api/agenda/aviso", token: "secreto",
    });
    expect(r).toEqual({ recursoId: "recurso-1", vence: "2030-01-01T00:00:00.000Z" });
  });

  it("abrirCanal sin resourceId avisa que el canal quedó abierto, con su id", async () => {
    fetchMock.mockResolvedValue(json(200, { expiration: "1893456000000" }));
    const e = (await abrirCanal("ana@polcecal.com", "canal-1", "s", "https://x.example/a").catch((x: Error) => x)) as Error;
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain("canal-1");
    expect(e.message).toContain("quedó abierto");
  });

  it("abrirCanal sin expiration válido avisa que quedó abierto y da el resourceId para cerrarlo", async () => {
    for (const expiration of [undefined, "no-es-un-numero"]) {
      fetchMock.mockResolvedValue(json(200, { resourceId: "recurso-1", expiration }));
      const e = (await abrirCanal("ana@polcecal.com", "canal-1", "s", "https://x.example/a").catch((x: Error) => x)) as Error;
      expect(e.message).toContain("canal-1");
      expect(e.message).toContain("quedó abierto");
      expect(e.message).toContain("recurso-1");
    }
  });

  it("cerrarCanal impersona a la casilla y manda id y recurso", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await cerrarCanal("ana@polcecal.com", "canal-1", "recurso-1");
    expect(obtenerToken).toHaveBeenCalledWith(["https://www.googleapis.com/auth/calendar"], "ana@polcecal.com");
    const { url, cuerpo } = pedido();
    expect(url).toBe("https://www.googleapis.com/calendar/v3/channels/stop");
    expect(cuerpo).toEqual({ id: "canal-1", resourceId: "recurso-1" });
  });
});

describe("la espera a Google", () => {
  it("corta a los 30 segundos con un mensaje propio", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      // La cota tiene que viajar como señal; el corte lo simula el mock.
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const e = await crearEvento("ana@polcecal.com", EVENTO, "all").catch((x: Error) => x);
    expect((e as Error).message).toContain("Google no contestó en 30 segundos");
    expect((e as Error).message).not.toContain("aborted due to timeout");
  });

  it("un error de red que no es de tiempo no se disfraza", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(leerEvento("ana@polcecal.com", "e1")).rejects.toThrow("fetch failed");
  });
});
