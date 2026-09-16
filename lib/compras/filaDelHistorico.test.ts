import { describe, it, expect } from "vitest";
import { filaDelHistorico } from "./seguimiento";

/** Una fila A..M tal como la devuelve la API de Sheets. */
const fila = (...celdas: string[]) => celdas;

describe("filaDelHistorico", () => {
  it("lee una fila completa", () => {
    const r = filaDelHistorico(fila(
      "1952", "", "Mantenimiento", "Cable TPR", "SINGLA", "Ambas",
      "100", "100", "8/9/2026", "15/9/2026", "ENVIADO", "Si", "Si"
    ));
    expect(r).toEqual({
      nro_ri: 1952,
      cantidad_comprada: 100,
      cantidad_recibida: 100,
      fecha_estimada_recepcion: "2026-09-08",
      fecha_recepcion: "2026-09-15",
      cumplio_compras: "SI",
      cumplio_proveedor: "SI",
      sucias: [],
    });
  });

  /** Las 363 filas sin NºRI son restos de fórmula con #N/A. No son compras. */
  it("una fila sin NºRI no es una compra", () => {
    expect(filaDelHistorico(fila("", "", "#N/A", "#N/A"))).toBeNull();
  });

  /** Las fechas de la planilla van en d/m. Al revés dio vuelta 885 fechas. */
  it("lee las fechas en d/m y no en m/d", () => {
    const r = filaDelHistorico(fila(
      "9", "", "Almacén", "x", "y", "Polcecal", "1", "1", "", "3/9/2025", "", "", ""
    ));
    expect(r?.fecha_recepcion).toBe("2025-09-03");
  });

  it("reconoce los tres juicios escritos como están en la planilla", () => {
    const r = filaDelHistorico(fila(
      "9", "", "a", "b", "c", "", "1", "1", "", "", "", "Más o menos", "No"
    ));
    expect(r?.cumplio_compras).toBe("MAS_O_MENOS");
    expect(r?.cumplio_proveedor).toBe("NO");
  });

  /**
   * Hay un "1500x1500" en la columna de cantidad recibida. Queda en null y se
   * informa: enlazar al que se le parece es peor que dejar en null, y un 1500
   * inventado no se nota nunca.
   */
  it("una cantidad que no es un número queda en null y se informa", () => {
    const r = filaDelHistorico(fila(
      "9", "", "a", "b", "c", "", "1", "1500x1500", "", "", "", "", ""
    ));
    expect(r?.cantidad_recibida).toBeNull();
    expect(r?.sucias).toEqual(['cantidad recibida "1500x1500"']);
  });

  it("una celda vacía no es una celda sucia", () => {
    const r = filaDelHistorico(fila("9", "", "a", "b", "c", "", "", "", "", "", "", "", ""));
    expect(r?.cantidad_recibida).toBeNull();
    expect(r?.sucias).toEqual([]);
  });
});
