import { describe, it, expect } from "vitest";
import { traerTodo, paginaPedida } from "./paginado";

/** Simula PostgREST: nunca devuelve más de `tope` filas por pedido. */
function tablaFalsa(total: number, tope = 1000) {
  const filas = Array.from({ length: total }, (_, i) => ({ n: i }));
  let llamadas = 0;
  return {
    llamadas: () => llamadas,
    pagina: async (desde: number, hasta: number) => {
      llamadas++;
      const fin = Math.min(hasta + 1, desde + tope);
      return { data: filas.slice(desde, fin), error: null };
    },
  };
}

describe("traerTodo", () => {
  it("trae todo cuando hay más del tope de una página", async () => {
    const t = tablaFalsa(1846);
    expect((await traerTodo(t.pagina)).length).toBe(1846);
    expect(t.llamadas()).toBe(2);
  });

  it("una sola llamada si entra en la primera página", async () => {
    const t = tablaFalsa(150);
    expect((await traerTodo(t.pagina)).length).toBe(150);
    expect(t.llamadas()).toBe(1);
  });

  it("no se cuelga con una tabla vacía", async () => {
    const t = tablaFalsa(0);
    expect(await traerTodo(t.pagina)).toEqual([]);
    expect(t.llamadas()).toBe(1);
  });

  it("corta bien cuando el total es múltiplo exacto del tamaño", async () => {
    const t = tablaFalsa(2000);
    expect((await traerTodo(t.pagina)).length).toBe(2000);
    // La tercera confirma que no hay más; sin ella se perderían filas.
    expect(t.llamadas()).toBe(3);
  });

  it("propaga el error en vez de devolver datos incompletos", async () => {
    await expect(
      traerTodo(async () => ({ data: null, error: { message: "se cayó" } }))
    ).rejects.toThrow("se cayó");
  });
});

describe("paginaPedida", () => {
  it("la pagina normal pasa tal cual", () => {
    expect(paginaPedida("1")).toBe(1);
    expect(paginaPedida("7")).toBe(7);
  });

  /**
   * `Number(searchParams.get("page") ?? 1)` daba NaN o 0 y el `.range()` que
   * salia de ahi —`Range: NaN-NaN`, o -50 a -1— lo rechaza PostgREST. El
   * handler no lo atrapaba: 500 con stack en vez del listado.
   */
  it("lo que no es una pagina cae a la primera, no a un 500", () => {
    expect(paginaPedida("abc")).toBe(1);
    expect(paginaPedida("0")).toBe(1);
    expect(paginaPedida("-5")).toBe(1);
    expect(paginaPedida("")).toBe(1);
    expect(paginaPedida(null)).toBe(1);
    expect(paginaPedida(undefined)).toBe(1);
    expect(paginaPedida("Infinity")).toBe(1);
  });

  it("un decimal se trunca: no hay media pagina", () => {
    expect(paginaPedida("2.9")).toBe(2);
  });
});
