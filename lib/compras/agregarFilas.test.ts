import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/core/google", () => ({
  obtenerToken: vi.fn(async () => "token"),
  hayCredencialesGoogle: () => true,
  mensajeDeGoogle: (status: number, cuerpo: string) => `Google ${status}: ${cuerpo}`,
  cuentaDeServicio: () => "cuenta@ejemplo",
  SCOPE_SHEETS: "sheets",
  SCOPE_DRIVE_LECTURA: "drive",
}));

import { agregarFilas } from "./drive";

type Llamada = { url: string; metodo: string; cuerpo?: string };
let llamadas: Llamada[];

function simularGoogle(columnaA: string[][]) {
  llamadas = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url, metodo: init?.method ?? "GET", cuerpo: init?.body as string | undefined });
    if (init?.method === "PUT") return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ values: columnaA }), { status: 200 });
  }));
}

beforeEach(() => { llamadas = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("agregarFilas", () => {
  it("lee la columna A una sola vez y escribe todo el bloque en una sola llamada", async () => {
    simularGoogle([["h"], ["x"], ["y"]]); // próxima fila libre: la 4
    const primera = await agregarFilas("ID", "Hoja 1", (f) => [
      [`a${f}`, "b"],
      [`a${f + 1}`, "b", "c"],
    ]);
    expect(primera).toBe(4);
    expect(llamadas.filter((l) => l.metodo === "GET")).toHaveLength(1);
    const puts = llamadas.filter((l) => l.metodo === "PUT");
    expect(puts).toHaveLength(1);
    expect(decodeURIComponent(puts[0].url)).toContain("Hoja 1!A4:C5");
    expect(puts[0].url).toContain("valueInputOption=USER_ENTERED");
    expect(JSON.parse(puts[0].cuerpo!).values).toEqual([["a4", "b"], ["a5", "b", "c"]]);
  });

  // 13/10/2026: leer una planilla que recalcula es indistinguible de leer una
  // vacía, y una OT nueva fue a parar encima de la fila 623.
  it("no escribe en una planilla cuya columna A viene como Cargando...", async () => {
    simularGoogle([["Cargando..."]]);
    await expect(agregarFilas("ID", "Hoja 1", () => [["a"]])).rejects.toThrow();
    expect(llamadas.filter((l) => l.metodo === "PUT")).toHaveLength(0);
  });

  it("un bloque vacío no escribe nada", async () => {
    simularGoogle([["h"]]);
    await expect(agregarFilas("ID", "Hoja 1", () => [])).rejects.toThrow();
    expect(llamadas.filter((l) => l.metodo === "PUT")).toHaveLength(0);
  });
});
