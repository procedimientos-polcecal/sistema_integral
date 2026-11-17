import { describe, it, expect } from "vitest";
import { horasDeParada, cantidadOpcional, leerCantidadesDelParte } from "./cantidades";

/**
 * El bug de la coma decimal, 05/11/2026. En Trituración era la mitad
 * silenciosa: `Number("1,5") || 0` da 0 y `Number("1.440")` da 1,44, las dos
 * sin un error. El parte se guardaba con una parada en cero y la planta
 * aparecía con disponibilidad del 100 %.
 */
describe("horasDeParada", () => {
  it("la coma decimal es un decimal, no un cero", () => {
    expect(horasDeParada("1,5", "las horas de mantenimiento")).toEqual({ ok: true, valor: 1.5 });
    expect(horasDeParada("0,25", "las horas de mantenimiento")).toEqual({ ok: true, valor: 0.25 });
  });

  it("vacío es cero: no hubo parada", () => {
    expect(horasDeParada("", "las horas")).toEqual({ ok: true, valor: 0 });
    expect(horasDeParada("   ", "las horas")).toEqual({ ok: true, valor: 0 });
    expect(horasDeParada(null, "las horas")).toEqual({ ok: true, valor: 0 });
  });

  /** Lo que `|| 0` convertía en un cero sin avisar. */
  it("lo que no es un número es un error y nunca un cero", () => {
    const r = horasDeParada("dos", "las horas de mantenimiento");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("las horas de mantenimiento");
  });

  it("una parada negativa no existe", () => {
    expect(horasDeParada("-1", "las horas").ok).toBe(false);
  });
});

describe("cantidadOpcional", () => {
  /**
   * Medido el 05/11/2026 sobre los 263 partes cargados: 11 de 159 declaran más
   * de mil toneladas y el máximo es 1440. Acá "1.440" son mil cuatrocientos
   * cuarenta, que es la diferencia con la lectura de Calidad/Ensayos.
   */
  it("el punto de miles es de miles", () => {
    expect(cantidadOpcional("1.440", "las toneladas")).toEqual({ ok: true, valor: 1440 });
    expect(cantidadOpcional("1.234,5", "las toneladas")).toEqual({ ok: true, valor: 1234.5 });
  });

  it("la coma decimal entra", () => {
    expect(cantidadOpcional("980,5", "las toneladas")).toEqual({ ok: true, valor: 980.5 });
  });

  /** Vacío es "no se contó", que no es lo mismo que cero. */
  it("vacío es null y no cero", () => {
    expect(cantidadOpcional("", "las toneladas")).toEqual({ ok: true, valor: null });
    expect(cantidadOpcional(null, "las toneladas")).toEqual({ ok: true, valor: null });
  });

  it("lo que no es un número es un error", () => {
    expect(cantidadOpcional("mil", "las toneladas").ok).toBe(false);
    expect(cantidadOpcional("-4", "las toneladas").ok).toBe(false);
  });
});

describe("leerCantidadesDelParte", () => {
  const vacio = {
    horas_mantenimiento: "", horas_falta_piedra: "", horas_produccion: "", horas_otro: "",
    camiones_llegados: "", toneladas_procesadas: "",
  };

  it("lee el parte entero con comas y puntos de miles", () => {
    const r = leerCantidadesDelParte({
      ...vacio, horas_mantenimiento: "1,5", horas_falta_piedra: "0,25", toneladas_procesadas: "1.440",
      camiones_llegados: "72",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.horas_mantenimiento).toBeCloseTo(1.5);
      expect(r.valor.horas_falta_piedra).toBeCloseTo(0.25);
      expect(r.valor.toneladas_procesadas).toBe(1440);
      expect(r.valor.camiones_llegados).toBe(72);
      expect(r.valor.horas_produccion).toBe(0);
    }
  });

  /** Todos los problemas juntos y en castellano, no de a uno. */
  it("junta los problemas en vez de nombrar uno solo", () => {
    const r = leerCantidadesDelParte({ ...vacio, horas_mantenimiento: "dos", toneladas_procesadas: "mil" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores).toHaveLength(2);
      expect(r.errores.join(" ")).toContain("mantenimiento");
      expect(r.errores.join(" ")).toContain("toneladas");
    }
  });
});
