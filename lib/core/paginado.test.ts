import { describe, it, expect } from "vitest";
import { traerTodo, traerTodoEnParalelo, paginaPedida } from "./paginado";

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

/** Igual que `tablaFalsa`, pero además devuelve `count` como lo hace PostgREST con `{ count: "exact" }` — lo que necesita `traerTodoEnParalelo`. */
function tablaFalsaConCount(total: number, tope = 1000) {
  const filas = Array.from({ length: total }, (_, i) => ({ n: i }));
  let llamadas = 0;
  return {
    llamadas: () => llamadas,
    pagina: async (desde: number, hasta: number) => {
      llamadas++;
      const fin = Math.min(hasta + 1, desde + tope);
      return { data: filas.slice(desde, fin), count: total, error: null };
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

describe("traerTodoEnParalelo", () => {
  it("trae todo cuando hay más del tope de una página, igual que traerTodo", async () => {
    const t = tablaFalsaConCount(7623);
    const filas = await traerTodoEnParalelo(t.pagina);
    expect(filas.length).toBe(7623);
    // Están en orden aunque las páginas de después de la primera lleguen en paralelo.
    expect(filas.map((f) => f.n)).toEqual(Array.from({ length: 7623 }, (_, i) => i));
  });

  it("pide una sola vez si entra en la primera página", async () => {
    const t = tablaFalsaConCount(150);
    expect((await traerTodoEnParalelo(t.pagina)).length).toBe(150);
    expect(t.llamadas()).toBe(1);
  });

  it("con el total exacto conocido, no pide de más: ni una página vacía extra", async () => {
    // 2000 filas = exactamente 2 páginas de 1000. traerTodo necesita una
    // tercera llamada vacía para confirmar que no hay más; acá el `count`
    // ya lo dice, así que son sólo 2.
    const t = tablaFalsaConCount(2000);
    expect((await traerTodoEnParalelo(t.pagina)).length).toBe(2000);
    expect(t.llamadas()).toBe(2);
  });

  it("sin count (el caller no lo pidió), se queda con la primera página tal cual venga", async () => {
    const t = tablaFalsa(2500); // tablaFalsa no manda count
    const filas = await traerTodoEnParalelo(t.pagina);
    expect(filas.length).toBe(1000);
    expect(t.llamadas()).toBe(1);
  });

  it("no se cuelga con una tabla vacía", async () => {
    const t = tablaFalsaConCount(0);
    expect(await traerTodoEnParalelo(t.pagina)).toEqual([]);
  });

  it("propaga el error de la primera página", async () => {
    await expect(
      traerTodoEnParalelo(async () => ({ data: null, count: null, error: { message: "se cayó" } }))
    ).rejects.toThrow("se cayó");
  });

  it("propaga el error de una página pedida en paralelo", async () => {
    let llamada = 0;
    await expect(
      traerTodoEnParalelo(async (desde) => {
        llamada++;
        if (desde === 0) return { data: Array.from({ length: 1000 }, (_, i) => ({ n: i })), count: 3000, error: null };
        return { data: null, count: 3000, error: { message: `falló la página de ${desde}` } };
      })
    ).rejects.toThrow(/falló la página/);
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
