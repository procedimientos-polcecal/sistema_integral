import { describe, it, expect } from "vitest";
import { traerTodo } from "./paginado";

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
