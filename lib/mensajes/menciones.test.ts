import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTIDADES } from "./entidades";
import { contarMencionesSinLeer, mencionesSinLeerVisibles } from "./menciones";

/** Un cliente que contesta lo mismo a cualquier cadena de `.from().select()…range()`. */
function clienteConFilas(filas: unknown[] | null, error: string | null = null): SupabaseClient {
  const cadena: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "range"]) cadena[m] = () => cadena;
  cadena.returns = () => Promise.resolve({ data: filas, error: error ? { message: error } : null });
  return { from: () => cadena } as unknown as SupabaseClient;
}

const fila = (tipo: string, id: string) => ({
  mensaje_id: `m-${id}`,
  mensajes: { entidad_tipo: tipo, entidad_id: id, texto: "hola", creado_en: "2026-11-12T10:00:00Z", autor: null },
});

afterEach(() => vi.restoreAllMocks());

describe("contarMencionesSinLeer", () => {
  it("cuenta mensajes, no hilos", async () => {
    vi.spyOn(ENTIDADES.orden_trabajo, "puedeVerlo").mockResolvedValue(true);
    const admin = clienteConFilas([fila("orden_trabajo", "a"), fila("orden_trabajo", "a"), fila("orden_trabajo", "b")]);
    expect(await contarMencionesSinLeer(admin, "u1")).toBe(3);
  });

  it("no cuenta la mención de un hilo cuyo registro ya no puede ver", async () => {
    vi.spyOn(ENTIDADES.orden_trabajo, "puedeVerlo").mockResolvedValue(false);
    vi.spyOn(ENTIDADES.requerimiento, "puedeVerlo").mockResolvedValue(true);
    const admin = clienteConFilas([fila("orden_trabajo", "a"), fila("requerimiento", "r")]);
    const visibles = await mencionesSinLeerVisibles(admin, "u1");
    expect(visibles.map((f) => f.mensajes.entidad_tipo)).toEqual(["requerimiento"]);
    expect(await contarMencionesSinLeer(admin, "u1")).toBe(1);
  });

  it("si la lectura falla da 0 y no tira: la campana no puede caerse", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await contarMencionesSinLeer(clienteConFilas(null, "relation does not exist"), "u1")).toBe(0);
  });
});
