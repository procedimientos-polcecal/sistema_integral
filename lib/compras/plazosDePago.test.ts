import { describe, it, expect } from "vitest";
import { plazosDePago, textoDePlazos, plazosAlCambiarDeProveedor } from "./comparativa";

/**
 * Los casos de acá salieron de leer la columna PLAZOS de 25 de los 198 libros
 * de comparativa el 16/09/2026. No son inventados: son los cinco formatos que
 * la gente escribe, con su frecuencia.
 */
describe("plazosDePago", () => {
  it("un plazo solo es un plazo solo", () => {
    expect(plazosDePago("30")).toEqual([30]);
    expect(plazosDePago("120")).toEqual([120]);
  });

  /** Contado es cero, y cero es un valor: no es lo mismo que no saber. */
  it("el contado es cero y no vacío", () => {
    expect(plazosDePago("0")).toEqual([0]);
  });

  it("los cinco formatos que están en las planillas", () => {
    expect(plazosDePago("30, 60")).toEqual([30, 60]);
    expect(plazosDePago("30, 60, 90")).toEqual([30, 60, 90]);
    expect(plazosDePago("30, 45, 60")).toEqual([30, 45, 60]);
    expect(plazosDePago("0, 30, 60, 90")).toEqual([0, 30, 60, 90]);
    expect(plazosDePago("30, 60, 90, 120")).toEqual([30, 60, 90, 120]);
  });

  /**
   * EL BUG QUE ESTO ARREGLA. La guarda vieja miraba barra y pipe, pero la gente
   * usa coma — y `numeroArgentino` la lee como separador decimal, así que
   * "30, 60" entraba como 30,6 y se guardaba redondeado a 31. Once cotizaciones
   * quedaron con un plazo que nadie escribió nunca.
   */
  it("«30, 60» son dos cuotas y no 31 días", () => {
    expect(plazosDePago("30, 60")).not.toEqual([31]);
    expect(plazosDePago("45, 60")).toEqual([45, 60]);
  });

  it("también separa por barra, pipe y punto y coma", () => {
    expect(plazosDePago("30/60")).toEqual([30, 60]);
    expect(plazosDePago("30|60")).toEqual([30, 60]);
    expect(plazosDePago("30; 60")).toEqual([30, 60]);
  });

  /**
   * Seis cotizaciones tienen "30 y 45 dias CTA CTE" en el campo de condiciones,
   * que es texto libre: la gente ya expresaba las cuotas donde podía.
   */
  it("entiende el «y» y el texto que lo rodea", () => {
    expect(plazosDePago("30 y 45 dias CTA CTE")).toEqual([30, 45]);
    expect(plazosDePago("30 Y 60")).toEqual([30, 60]);
  });

  it("ordena y no repite", () => {
    expect(plazosDePago("60, 30")).toEqual([30, 60]);
    expect(plazosDePago("30, 30, 60")).toEqual([30, 60]);
  });

  it("sin nada que leer no devuelve nada", () => {
    expect(plazosDePago("")).toEqual([]);
    expect(plazosDePago(null)).toEqual([]);
    expect(plazosDePago(undefined)).toEqual([]);
    expect(plazosDePago("   ")).toEqual([]);
  });

  /**
   * Lo que no puede ser un plazo se descarta en vez de entrar como cualquier
   * cosa. El tope es un año, que ya es más de lo que nadie financia; "1.500"
   * son mil quinientos y no quince días.
   */
  it("lo que no es un plazo no entra", () => {
    expect(plazosDePago("contado")).toEqual([]);
    expect(plazosDePago("1.500")).toEqual([]);
    expect(plazosDePago("-30")).toEqual([]);
    // Se queda con el que sí es un plazo y descarta el otro.
    expect(plazosDePago("30, 1500")).toEqual([30]);
  });

  /** La columna es `integer`: un decimal hacía fallar el INSERT entero. */
  it("redondea los decimales", () => {
    expect(plazosDePago("30.5")).toEqual([31]);
  });
});

describe("textoDePlazos", () => {
  it("sin dato no inventa", () => {
    expect(textoDePlazos(null)).toBe("—");
    expect(textoDePlazos([])).toBe("—");
  });

  it("el cero se lee contado", () => {
    expect(textoDePlazos([0])).toBe("contado");
  });

  it("uno solo se dice en días", () => {
    expect(textoDePlazos([30])).toBe("30 días");
    expect(textoDePlazos([1])).toBe("1 día");
  });

  /**
   * Varios son CUOTAS, no opciones: una parte a 30 días y otra a 60. Decir
   * "30, 60 días" dejaría que se lea como "elegí uno", que es otra cosa.
   */
  it("varios se dicen como cuotas", () => {
    expect(textoDePlazos([30, 60])).toBe("2 cuotas: 30 y 60 días");
    expect(textoDePlazos([30, 60, 90])).toBe("3 cuotas: 30, 60 y 90 días");
  });

  it("una cuota al contado sigue siendo una cuota", () => {
    expect(textoDePlazos([0, 30])).toBe("2 cuotas: contado y 30 días");
  });
});

/**
 * La misma regla que `alCambiarDeProveedor`: lo que escribió una persona manda.
 * Si para esta compra se acordaron cuotas distintas a las habituales del
 * proveedor, cambiar de proveedor no puede borrarlas.
 */
describe("plazosAlCambiarDeProveedor", () => {
  it("un campo vacío se completa con lo del proveedor nuevo", () => {
    expect(plazosAlCambiarDeProveedor([], [], [30])).toEqual([30]);
  });

  it("lo que puso el autocompletado se reemplaza", () => {
    expect(plazosAlCambiarDeProveedor([30], [30], [60])).toEqual([60]);
  });

  it("lo que escribió una persona NO se pisa", () => {
    expect(plazosAlCambiarDeProveedor([30, 60], [30], [45])).toEqual([30, 60]);
  });

  it("el proveedor nuevo sin plazo no borra lo que hay", () => {
    expect(plazosAlCambiarDeProveedor([30, 60], [30], [])).toEqual([30, 60]);
  });
});
