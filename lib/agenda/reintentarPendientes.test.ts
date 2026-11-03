import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./escribirEnGoogle", async (original) => ({
  ...(await original<typeof import("./escribirEnGoogle")>()),
  escribirEnGoogle: vi.fn(),
}));

import { escribirEnGoogle } from "./escribirEnGoogle";
import { quePendientesReintentar, reintentarLosPendientes } from "./reintentarPendientes";
import { baseEnMemoria, type Fila } from "./baseEnMemoria.testhelper";

const AHORA = new Date("2026-11-03T05:00:00.000Z");
const ANTES = "2026-11-02T14:00:00+00:00";

function pendiente(id: string, extra: Fila = {}): Fila {
  return {
    id,
    titulo: `Evento ${id}`,
    descripcion: null,
    lugar: null,
    inicio: "2026-11-04T11:00:00+00:00",
    fin: "2026-11-04T12:30:00+00:00",
    casilla: "mantenimiento@polcecal.com",
    google_event_id: null,
    divergencia: null,
    divergencia_el: null,
    google_pendiente: "Google dijo: 500",
    google_pendiente_el: ANTES,
    ...extra,
  };
}

const invitados = (...emails: string[]) => emails.map((email) => ({ evento_id: "1", email }));

beforeEach(() => vi.resetAllMocks());

describe("quePendientesReintentar", () => {
  it("un evento divergido no se reintenta, y dice por qué", () => {
    const r = quePendientesReintentar([
      { id: "1", divergencia: null },
      { id: "2", divergencia: "movido" },
      { id: "3", divergencia: "borrado" },
    ]);
    expect(r.reintentar.map((f) => f.id)).toEqual(["1"]);
    expect(r.saltados.map((s) => s.id)).toEqual(["2", "3"]);
    expect(r.saltados[0].motivo).toMatch(/destrabar/);
  });
});

describe("reintentarLosPendientes", () => {
  it("lo que vuelve a entrar se limpia, y los tres pares quedan enteros", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [pendiente("1")],
      agenda_invitados: invitados("ana@polcecal.com"),
    });
    vi.mocked(escribirEnGoogle).mockResolvedValue({
      google_event_id: "gx", inicio_escrito: "2026-11-04T08:00:00-03:00", fin_escrito: "2026-11-04T09:30:00-03:00",
    });

    const r = await reintentarLosPendientes(base.cliente, AHORA);

    expect(r).toMatchObject({ limpiados: 1, siguen: 0, divergidos: 0, saltados: 0, fallos: [] });
    expect(base.tablas.agenda_eventos[0]).toMatchObject({
      google_event_id: "gx",
      google_pendiente: null,
      google_pendiente_el: null,
      inicio_escrito: "2026-11-04T08:00:00-03:00",
      fin_escrito: "2026-11-04T09:30:00-03:00",
    });
  });

  it("lo que falla de nuevo se queda con el mensaje nuevo de Google, no con el viejo", async () => {
    const base = baseEnMemoria({ agenda_eventos: [pendiente("1")], agenda_invitados: [] });
    vi.mocked(escribirEnGoogle).mockResolvedValue({ pendiente: "Google dijo: 403 forbiddenForNonOrganizer" });

    const r = await reintentarLosPendientes(base.cliente, AHORA);

    expect(r.siguen).toBe(1);
    expect(base.tablas.agenda_eventos[0]).toMatchObject({
      google_pendiente: "Google dijo: 403 forbiddenForNonOrganizer",
      google_pendiente_el: AHORA.toISOString(),
    });
    expect(r.fallos[0]).toContain("forbiddenForNonOrganizer");
    expect(r.fallos[0]).toContain("Evento 1");
  });

  it("un evento divergido ni se toca: no se escribe en Google ni en la fila", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [pendiente("1", { divergencia: "movido", divergencia_el: ANTES })],
      agenda_invitados: invitados("ana@polcecal.com"),
    });

    const r = await reintentarLosPendientes(base.cliente, AHORA);

    expect(escribirEnGoogle).not.toHaveBeenCalled();
    expect(base.escrituras).toEqual([]);
    expect(r.saltados).toBe(1);
    expect(base.tablas.agenda_eventos[0].google_pendiente).toBe("Google dijo: 500");
  });

  it("sin id en Google crea (idempotente, con el id de la fila); con id actualiza y no resucita", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [
        pendiente("00000000-0000-0000-0000-000000000001"),
        pendiente("00000000-0000-0000-0000-000000000002", { google_event_id: "g2" }),
      ],
      agenda_invitados: [],
    });
    vi.mocked(escribirEnGoogle).mockResolvedValue({
      inicio_escrito: "2026-11-04T08:00:00-03:00", fin_escrito: "2026-11-04T09:30:00-03:00",
    });

    await reintentarLosPendientes(base.cliente, AHORA);

    const acciones = vi.mocked(escribirEnGoogle).mock.calls.map((c) => c[0]);
    expect(acciones).toEqual(["crear", "actualizar"]);
    expect(vi.mocked(escribirEnGoogle).mock.calls[0][2]?.id).toBe("00000000000000000000000000000001");
  });

  it("si Google dice que el evento estaba borrado, pasa a divergido en vez de resucitarlo", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [pendiente("1", { google_event_id: "g1" })],
      agenda_invitados: [],
    });
    vi.mocked(escribirEnGoogle).mockResolvedValue({ google_event_id: "g1", divergencia: "borrado" });

    const r = await reintentarLosPendientes(base.cliente, AHORA);

    expect(r.divergidos).toBe(1);
    expect(base.tablas.agenda_eventos[0]).toMatchObject({
      divergencia: "borrado",
      divergencia_el: AHORA.toISOString(),
      google_pendiente: null,
      google_pendiente_el: null,
    });
  });

  it("manda los invitados de la fila, en minúscula y sin el dueño", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [pendiente("1")],
      agenda_invitados: invitados("Ana@Polcecal.com", "mantenimiento@polcecal.com"),
    });
    vi.mocked(escribirEnGoogle).mockResolvedValue({ pendiente: "x" });

    await reintentarLosPendientes(base.cliente, AHORA);

    expect(vi.mocked(escribirEnGoogle).mock.calls[0][2]?.invitados).toEqual(["ana@polcecal.com"]);
  });

  it("cero filas de invitados no es «no hay invitados»: no se manda [] que los borraría de Google", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [pendiente("1", { google_event_id: "g1" })],
      agenda_invitados: [],
    });
    vi.mocked(escribirEnGoogle).mockResolvedValue({ pendiente: "x" });

    await reintentarLosPendientes(base.cliente, AHORA);

    expect(vi.mocked(escribirEnGoogle).mock.calls[0][2]?.invitados).toBeUndefined();
  });

  it("un fallo con un evento no corta a los demás", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [pendiente("1"), pendiente("2")],
      agenda_invitados: [],
    });
    vi.mocked(escribirEnGoogle)
      .mockResolvedValueOnce({ pendiente: "Google dijo: 500" })
      .mockResolvedValueOnce({ inicio_escrito: "2026-11-04T08:00:00-03:00", fin_escrito: "2026-11-04T09:30:00-03:00" });

    const r = await reintentarLosPendientes(base.cliente, AHORA);

    expect(r).toMatchObject({ siguen: 1, limpiados: 1 });
  });

  it("si Google recibió el evento y la fila no se pudo anotar, no cuenta como limpiado", async () => {
    const base = baseEnMemoria(
      { agenda_eventos: [pendiente("1")], agenda_invitados: [] },
      { falla: { agenda_eventos: { update: "se cayó la base" } } }
    );
    vi.mocked(escribirEnGoogle).mockResolvedValue({
      inicio_escrito: "2026-11-04T08:00:00-03:00", fin_escrito: "2026-11-04T09:30:00-03:00",
    });

    const r = await reintentarLosPendientes(base.cliente, AHORA);

    expect(r.limpiados).toBe(0);
    expect(r.fallos[0]).toContain("se cayó la base");
  });

  it("no toca los avisos: un borrado de espejo rechazado no está en la cola y no se levanta", async () => {
    const base = baseEnMemoria({
      agenda_eventos: [pendiente("1", { google_pendiente: null, google_pendiente_el: null, aviso: "No se pudo borrar" })],
      agenda_invitados: [],
    });

    await reintentarLosPendientes(base.cliente, AHORA);

    expect(escribirEnGoogle).not.toHaveBeenCalled();
    expect(base.tablas.agenda_eventos[0].aviso).toBe("No se pudo borrar");
  });

  it("si se acaba el tiempo, lo que queda sigue en la cola y se dice", async () => {
    const base = baseEnMemoria({ agenda_eventos: [pendiente("1"), pendiente("2")], agenda_invitados: [] });
    vi.mocked(escribirEnGoogle).mockResolvedValue({ pendiente: "x" });

    const r = await reintentarLosPendientes(base.cliente, AHORA, -1);

    expect(escribirEnGoogle).not.toHaveBeenCalled();
    expect(r.fallos[0]).toMatch(/2 pendientes sin reintentar/);
  });

  it("tira si no puede leer la cola", async () => {
    const base = baseEnMemoria({ agenda_eventos: [] }, { falla: { agenda_eventos: { select: "sin base" } } });
    await expect(reintentarLosPendientes(base.cliente, AHORA)).rejects.toThrow(/sin base/);
  });
});
