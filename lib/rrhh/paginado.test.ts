import { describe, it, expect } from "vitest";
import { traerPaginado, PAGINA } from "./paginado";

/** Simula el corte de PostgREST: devuelve como máximo PAGINA filas por pedido. */
function tablaFalsa(totalFilas: number) {
  const todas = Array.from({ length: totalFilas }, (_, i) => ({ id: i }));
  const pedidos: [number, number][] = [];
  const query = () => ({
    range: async (desde: number, hasta: number) => {
      pedidos.push([desde, hasta]);
      const largo = Math.min(hasta - desde + 1, PAGINA);
      return { data: todas.slice(desde, desde + largo), error: null };
    },
  });
  return { query, pedidos, todas };
}

describe("traerPaginado", () => {
  it("una sola página cuando hay menos filas que el corte: un solo pedido", async () => {
    const { query, pedidos } = tablaFalsa(324);
    const filas = await traerPaginado(query);
    expect(filas).toHaveLength(324);
    expect(pedidos).toHaveLength(1);
  });

  it("tabla vacía: un pedido y ninguna fila", async () => {
    const { query, pedidos } = tablaFalsa(0);
    expect(await traerPaginado(query)).toEqual([]);
    expect(pedidos).toHaveLength(1);
  });

  it("el caso que rompía: 1863 filas se traen completas, no las primeras 1000", async () => {
    const { query, pedidos } = tablaFalsa(1863);
    const filas = await traerPaginado(query);
    expect(filas).toHaveLength(1863);
    expect(pedidos).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("un año de cálculos diarios (14352 filas) se trae completo", async () => {
    const { query } = tablaFalsa(14352);
    const filas = await traerPaginado(query);
    expect(filas).toHaveLength(14352);
    expect(filas.map((f) => f.id)).toEqual(Array.from({ length: 14352 }, (_, i) => i));
  });

  it("múltiplo exacto del corte: pide una página más y corta ahí, sin duplicar", async () => {
    const { query, pedidos } = tablaFalsa(2000);
    const filas = await traerPaginado(query);
    expect(filas).toHaveLength(2000);
    expect(pedidos).toHaveLength(3); // 0-999, 1000-1999, y la vacía que confirma el final
    expect(new Set(filas.map((f) => f.id)).size).toBe(2000);
  });

  it("no se saltea ni repite ninguna fila", async () => {
    const { query, todas } = tablaFalsa(3500);
    const filas = await traerPaginado(query);
    expect(filas).toEqual(todas);
  });

  it("un error de la base se propaga con la etiqueta, no devuelve datos a medias", async () => {
    let llamadas = 0;
    const query = () => ({
      range: async () => {
        llamadas++;
        return llamadas === 1
          ? { data: Array.from({ length: PAGINA }, (_, i) => ({ id: i })), error: null }
          : { data: null, error: { message: "timeout" } };
      },
    });
    await expect(traerPaginado(query, "leyendo calculos_diarios")).rejects.toThrow("leyendo calculos_diarios: timeout");
  });
});
