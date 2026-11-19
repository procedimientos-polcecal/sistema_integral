import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/core/sheets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/sheets")>()),
  leerFormulas: vi.fn(),
  escribirCeldas: vi.fn(),
}));

import { escribirCeldas, leerFormulas } from "@/lib/core/sheets";
import { altaDeOSEnLaPlanilla } from "@/lib/mantenimiento/altaDeOS";
import { celdasDelAltaDeOS } from "@/lib/mantenimiento/formularioDeOS";

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

  it("si una lectura trae Cargando... no escribe (red fina: con FORMULA casi no dispara)", async () => {
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

  it("camino feliz: toma el siguiente numero, escribe las celdas en la fila libre y lo confirma", async () => {
    let escrito = false;
    planilla((rango) =>
      esElFormulario(rango) ? [["N"], ["10"]]
      : esLaColumnaDeAltas(rango) ? [["N"], ["11"]]
      : escrito ? [["12"]] : []
    );
    escribir.mockImplementation(async () => { escrito = true; });
    const r = await altaDeOSEnLaPlanilla(datos);
    expect(r).toEqual({ ok: true, os_number: 12, fila: 3 });

    const esperadas = celdasDelAltaDeOS(datos, 12);
    if (!esperadas.ok) throw new Error("el dato de prueba debia ser valido");
    expect(escribir).toHaveBeenCalledTimes(1);
    expect(escribir).toHaveBeenCalledWith(
      "planilla-de-prueba",
      esperadas.celdas.map((c) => ({
        pestana: "Altas del sistema", columna: c.columna, fila: 3, valor: c.valor,
      }))
    );
  });

  it("si despues de escribir la fila quedo con otro numero, lo dice", async () => {
    let escrito = false;
    planilla((rango) =>
      esElFormulario(rango) ? [["N"], ["10"]]
      : esLaColumnaDeAltas(rango) ? [["N"], ["11"]]
      : escrito ? [["13"]] : []
    );
    escribir.mockImplementation(async () => { escrito = true; });
    const r = await altaDeOSEnLaPlanilla(datos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/quedó con el N° "13" en vez de 12/);
  });
});
