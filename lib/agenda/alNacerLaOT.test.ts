import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./escribirEnGoogle", async (original) => ({
  ...(await original<typeof import("./escribirEnGoogle")>()),
  escribirEnGoogle: vi.fn(),
}));

import { escribirEnGoogle } from "./escribirEnGoogle";
import { alNacerLaOT } from "./alNacerLaOT";
import { baseEnMemoria, type Fila } from "./baseEnMemoria.testhelper";

/** Las 09:00 de Argentina del 04/11/2026, o sea «hoy» es el 04. */
const AHORA = new Date("2026-11-04T12:00:00.000Z");
const LA_OT = "11111111-1111-4111-8111-111111111111";

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

function base(tablas: Record<string, Fila[]> = {}, opciones = {}) {
  return baseEnMemoria(
    {
      ordenes_trabajo: [orden()],
      agenda_eventos: [],
      agenda_invitados: [],
      usuarios: [{ id: "u-mant", email: "Mantenimiento@Polcecal.com", activo: true }],
      ...tablas,
    },
    opciones
  );
}

const escriturasEnLaAgenda = (b: ReturnType<typeof base>) =>
  b.escrituras.filter((e) => e.tabla.startsWith("agenda_"));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(escribirEnGoogle).mockResolvedValue({
    google_event_id: "g1",
    inicio_escrito: "2026-11-06T08:00:00-03:00",
    fin_escrito: "2026-11-06T09:30:00-03:00",
  });
});

describe("cuando nace una OT", () => {
  it("una con fecha futura queda con evento, y no hay nada que avisar", async () => {
    const b = base();

    const r = await alNacerLaOT(b.cliente, LA_OT, AHORA);

    expect(r).toBeNull();
    expect(b.tablas.agenda_eventos).toHaveLength(1);
    expect(b.tablas.agenda_eventos[0]).toMatchObject({ ot_id: LA_OT, turno: "8-16" });
    expect(escribirEnGoogle).toHaveBeenCalledTimes(1);
  });

  it("una con fecha de hoy entra: el filtro es por día y no por hora", async () => {
    const b = base({ ordenes_trabajo: [orden({ fecha_ejecucion: "2026-11-04" })] });

    expect(await alNacerLaOT(b.cliente, LA_OT, AHORA)).toBeNull();
    expect(b.tablas.agenda_eventos).toHaveLength(1);
  });

  it("la fecha pendiente manda sobre la de la planilla", async () => {
    const b = base({
      ordenes_trabajo: [orden({ fecha_ejecucion: "2026-10-01", fecha_ejecucion_pendiente: "2026-11-06" })],
    });

    expect(await alNacerLaOT(b.cliente, LA_OT, AHORA)).toBeNull();
    expect(b.tablas.agenda_eventos).toHaveLength(1);
  });

  it("una con fecha pasada no genera nada y devuelve null", async () => {
    const b = base({ ordenes_trabajo: [orden({ fecha_ejecucion: "2026-11-03" })] });

    expect(await alNacerLaOT(b.cliente, LA_OT, AHORA)).toBeNull();
    expect(escriturasEnLaAgenda(b)).toEqual([]);
    expect(escribirEnGoogle).not.toHaveBeenCalled();
  });

  it("una sin fecha no genera nada y devuelve null", async () => {
    const b = base({ ordenes_trabajo: [orden({ fecha_ejecucion: null })] });

    expect(await alNacerLaOT(b.cliente, LA_OT, AHORA)).toBeNull();
    expect(escriturasEnLaAgenda(b)).toEqual([]);
  });

  it("una cerrada no genera nada, aunque su fecha sea futura", async () => {
    for (const cerrada of [{ fecha_cierre: "2026-11-03" }, { estado: "REALIZADO" }]) {
      const b = base({ ordenes_trabajo: [orden(cerrada)] });

      expect(await alNacerLaOT(b.cliente, LA_OT, AHORA)).toBeNull();
      expect(escriturasEnLaAgenda(b)).toEqual([]);
    }
    expect(escribirEnGoogle).not.toHaveBeenCalled();
  });
});

/**
 * Lo que no puede pasar nunca: que el espejo tumbe al dato. La OT ya está
 * guardada cuando esto corre, así que lo peor que puede hacer un fallo de
 * acá es una frase para quien mira, nunca una excepción que haga creer que la
 * orden no se creó.
 */
describe("el calendario nunca tumba a la OT", () => {
  it("si mandar devuelve un error, queda dicho con el número de la OT y no lanza", async () => {
    const b = base({}, { falla: { agenda_eventos: { select: "se cayó la base" } } });

    const r = await alNacerLaOT(b.cliente, LA_OT, AHORA);

    expect(r).toContain("2951");
    expect(r).toContain("se cayó la base");
  });

  it("si mandar explota con una excepción, devuelve la advertencia y no lanza", async () => {
    vi.mocked(escribirEnGoogle).mockRejectedValue(new Error("boom de Google"));
    const b = base();

    const r = await alNacerLaOT(b.cliente, LA_OT, AHORA);

    expect(r).toContain("2951");
    expect(r).toContain("boom de Google");
  });

  it("si lo que explota es la lectura de la orden, tampoco lanza", async () => {
    const cliente = { from: () => { throw new Error("sin conexión"); } } as never;

    const r = await alNacerLaOT(cliente, LA_OT, AHORA);

    expect(r).toContain("sin conexión");
  });

  it("una orden que no está lo dice en vez de callarlo", async () => {
    const b = base({ ordenes_trabajo: [] });

    const r = await alNacerLaOT(b.cliente, LA_OT, AHORA);

    expect(r).toContain("no se encontró");
  });

  it("si Google falla, el evento queda y la advertencia lo dice", async () => {
    vi.mocked(escribirEnGoogle).mockResolvedValue({ pendiente: "Google dijo: 500" });
    const b = base();

    const r = await alNacerLaOT(b.cliente, LA_OT, AHORA);

    expect(b.tablas.agenda_eventos).toHaveLength(1);
    expect(b.tablas.agenda_eventos[0]).toMatchObject({ google_pendiente: "Google dijo: 500" });
    expect(r).toContain("2951");
    expect(r).toContain("Google dijo: 500");
  });

  /** El automático nunca pisa lo que una persona tocó en Google. */
  it("con un evento que alguien movió en Google, no lo pisa: avisa", async () => {
    const b = base({
      agenda_eventos: [{
        id: "22222222-2222-4222-8222-222222222222", ot_id: LA_OT, dueno_id: "u-mant",
        casilla: "mantenimiento@polcecal.com", google_event_id: "g-viejo", divergencia: "movido",
        inicio: "2026-11-06T11:00:00.000Z", fin: "2026-11-06T12:30:00.000Z", turno: "8-16",
      }],
    });

    const r = await alNacerLaOT(b.cliente, LA_OT, AHORA);

    expect(escribirEnGoogle).not.toHaveBeenCalled();
    expect(r).toContain("2951");
  });
});
