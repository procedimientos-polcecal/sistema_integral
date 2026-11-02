import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google")>()),
  obtenerToken: vi.fn(async () => "token-de-prueba"),
}));

import { obtenerToken } from "./google";
import {
  ZONA_ARGENTINA, crearEvento, leerEvento, actualizarEvento, borrarEvento, abrirCanal, cerrarCanal,
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
    await crearEvento("ana@polcecal.com", EVENTO);

    const { cuerpo } = pedido();
    // Nueve de catorce calendarios están en UTC: sin esto el evento corre de hora.
    expect(cuerpo.start).toEqual({ dateTime: "2026-11-03T08:00:00", timeZone: ZONA_ARGENTINA });
    expect(cuerpo.end).toEqual({ dateTime: "2026-11-03T12:00:00", timeZone: ZONA_ARGENTINA });
  });

  it("pide el token de la casilla, avisa a los invitados y manda los campos de Google", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "e1" }));
    await crearEvento("ana@polcecal.com", EVENTO);

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
    expect(await crearEvento("ana@polcecal.com", EVENTO)).toEqual({
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
    await actualizarEvento("ana@polcecal.com", "e1", { inicio: "2026-11-04T08:00:00", fin: "2026-11-04T12:00:00" });

    const { url, metodo, cuerpo } = pedido();
    expect(metodo).toBe("PATCH");
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/e1?sendUpdates=all");
    expect(Object.keys(cuerpo).sort()).toEqual(["end", "start"]);
    expect(cuerpo.start.timeZone).toBe(ZONA_ARGENTINA);
    expect(cuerpo.end.timeZone).toBe(ZONA_ARGENTINA);
  });

  it("un 403 se propaga con lo que dijo Google", async () => {
    fetchMock.mockResolvedValue(json(403, { error: { message: "Not a delegate" } }));
    await expect(actualizarEvento("ana@polcecal.com", "e1", { titulo: "x" })).rejects.toThrow("Not a delegate");
  });
});

describe("borrarEvento", () => {
  it("borra avisando a los invitados", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await borrarEvento("ana@polcecal.com", "e1");
    const { url, metodo } = pedido();
    expect(metodo).toBe("DELETE");
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/e1?sendUpdates=all");
  });

  it("uno ya borrado (410) no es un error", async () => {
    fetchMock.mockResolvedValue(json(410, { error: { code: 410, message: "Resource has been deleted" } }));
    await expect(borrarEvento("ana@polcecal.com", "e1")).resolves.toBeUndefined();
  });

  it("uno que Google no conoce (404) tampoco: ya no está, que es lo que se quería", async () => {
    fetchMock.mockResolvedValue(json(404, { error: { code: 404, message: "Not Found" } }));
    await expect(borrarEvento("ana@polcecal.com", "e1")).resolves.toBeUndefined();
  });

  it("otro fallo se propaga", async () => {
    fetchMock.mockResolvedValue(json(500, { error: { message: "Backend Error" } }));
    await expect(borrarEvento("ana@polcecal.com", "e1")).rejects.toThrow("Backend Error");
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
    const e = await crearEvento("ana@polcecal.com", EVENTO).catch((x: Error) => x);
    expect((e as Error).message).toContain("Google no contestó en 30 segundos");
    expect((e as Error).message).not.toContain("aborted due to timeout");
  });

  it("un error de red que no es de tiempo no se disfraza", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(leerEvento("ana@polcecal.com", "e1")).rejects.toThrow("fetch failed");
  });
});
