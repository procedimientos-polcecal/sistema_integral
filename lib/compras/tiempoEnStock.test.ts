import { describe, it, expect } from "vitest";
import { tiempoEnStock } from "./seguimiento";

/**
 * Los casos salieron de medir las 343 filas de Mantenimiento que tienen las dos
 * fechas cargadas: mediana 3 días, percentil 75 en 7, máximo 66, 124 en cero y
 * **13 negativas**. Esas 13 son lo que este módulo tiene que saber decir.
 */
describe("tiempoEnStock", () => {
  it("dice cuántos días estuvo guardado", () => {
    expect(tiempoEnStock("2026-09-01", "2026-09-04")).toBe("3 días en stock");
    expect(tiempoEnStock("2026-07-01", "2026-09-05")).toBe("66 días en stock");
  });

  it("un día se dice en singular", () => {
    expect(tiempoEnStock("2026-09-01", "2026-09-02")).toBe("1 día en stock");
  });

  /** 124 de las 343: llegó y se usó el mismo día. No estuvo en stock. */
  it("el mismo día no es «0 días en stock»", () => {
    expect(tiempoEnStock("2026-09-01", "2026-09-01")).toBe("se aplicó el mismo día");
  });

  /**
   * Trece filas dicen que el material se aplicó ANTES de recibirse. Son datos
   * mal cargados, y mostrar "-15 días en stock" los disfraza de medición. Se
   * nombra el problema.
   */
  it("una aplicación anterior a la recepción se denuncia, no se muestra en negativo", () => {
    expect(tiempoEnStock("2026-09-16", "2026-09-01")).toBe(
      "la fecha de aplicación es anterior a la de recepción"
    );
  });

  it("sin alguna de las dos fechas no dice nada", () => {
    expect(tiempoEnStock(null, "2026-09-01")).toBeNull();
    expect(tiempoEnStock("2026-09-01", null)).toBeNull();
    expect(tiempoEnStock(null, null)).toBeNull();
  });

  /**
   * La misma guardia que el resto del archivo: una fecha que no existe o que no
   * viene como YYYY-MM-DD no produce un número inventado.
   */
  it("una fecha ilegible no inventa un plazo", () => {
    expect(tiempoEnStock("2026-02-30", "2026-09-01")).toBeNull();
    expect(tiempoEnStock(" ", "2026-09-01")).toBeNull();
    expect(tiempoEnStock("1/9/2026", "2026-09-04")).toBeNull();
  });
});
