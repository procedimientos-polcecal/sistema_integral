import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/core/sheets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/sheets")>()),
  leerFormulas: vi.fn(),
  escribirCeldas: vi.fn(),
}));

import { escribirCeldas, leerFormulas } from "@/lib/core/sheets";
import { altaDeOSEnLaPlanilla } from "@/lib/mantenimiento/altaDeOS";

const leer = vi.mocked(leerFormulas);
const escribir = vi.mocked(escribirCeldas);

const datos = {
  fecha: new Date("2026-11-19T12:00:00Z"),
  area: "Mantenimiento",
  sector: "Molienda de cal",
  equipo: "Torno",
  descripcion: "Cambiar rodamiento",
  fechaRequerimiento: "2026-11-25",
  detalleExtra: null,
};

/** Responde cada lectura según el rango que se pidió. */
function planilla(porRango: (rango: string) => string[][]) {
  leer.mockImplementation(async (_id, rango) => porRango(rango));
}

const esElFormulario = (rango: string) => rango.startsWith("Respuestas");
const esLaColumnaDeAltas = (rango: string) => rango === "Altas del sistema!A:A";

beforeEach(() => {
  vi.stubEnv("GOOGLE_SHEETS_OS_FORMULARIO_ID", "planilla-de-prueba");
  leer.mockReset();
  escribir.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("altaDeOSEnLaPlanilla", () => {
  it("no escribe si entre leer y escribir alguien tomo la fila", async () => {
    planilla((rango) =>
      esElFormulario(rango) ? [["N"], ["10"]]
      : esLaColumnaDeAltas(rango) ? [["N"], ["11"]]
      : [["99"]] // la celda destino ya tiene algo
    );
    const r = await altaDeOSEnLaPlanilla(datos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("se ocupó");
    expect(escribir).not.toHaveBeenCalled();
  });

  it("dice que falta la variable con su nombre", async () => {
    vi.stubEnv("GOOGLE_SHEETS_OS_FORMULARIO_ID", "");
    const r = await altaDeOSEnLaPlanilla(datos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("GOOGLE_SHEETS_OS_FORMULARIO_ID");
    expect(leer).not.toHaveBeenCalled();
  });

  it("distingue una planilla calculando de una hoja vacia", async () => {
    planilla(() => [["Cargando..."]]);
    const r = await altaDeOSEnLaPlanilla(datos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Cargando");
    expect(escribir).not.toHaveBeenCalled();
  });

  it("devuelve lo que dijo Google sin traducir", async () => {
    planilla((rango) =>
      esElFormulario(rango) ? [["N"], ["10"]]
      : esLaColumnaDeAltas(rango) ? [["N"], ["11"]]
      : []
    );
    escribir.mockRejectedValue(new Error("The caller does not have permission"));
    const r = await altaDeOSEnLaPlanilla(datos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("The caller does not have permission");
  });
});
