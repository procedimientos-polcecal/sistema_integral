import { describe, it, expect } from "vitest";
import { comoFecha, comoMonto, comoMontos, comoToneladas, nombreDelTipo } from "./formato";

describe("comoMonto", () => {
  it("usa el formato argentino y no muestra centavos", () => {
    expect(comoMonto(1234567.89, "ARS")).toBe("$1.234.568");
    expect(comoMonto(12000, "USD")).toBe("USD 12.000");
  });
});

describe("comoMontos", () => {
  it("muestra las dos monedas separadas", () => {
    expect(comoMontos({ ARS: 1000, USD: 50 })).toBe("$1.000 · USD 50");
  });

  /**
   * Un «$0 · USD 12.000» hace pensar que falta algo en pesos. Y las dos en
   * cero es una columna vacía, no oportunidades por cero pesos.
   */
  it("una moneda en cero no se escribe, y las dos dan un guión", () => {
    expect(comoMontos({ ARS: 0, USD: 50 })).toBe("USD 50");
    expect(comoMontos({ ARS: 1000, USD: 0 })).toBe("$1.000");
    expect(comoMontos({ ARS: 0, USD: 0 })).toBe("—");
  });
});

describe("comoToneladas", () => {
  it("agrega la unidad y redondea a un decimal", () => {
    expect(comoToneladas(1500)).toBe("1.500 t");
    expect(comoToneladas(12.34)).toBe("12,3 t");
  });

  // «0 t» dice que se midió y dio cero; lo que pasa es que nadie las cargó.
  it("cero y vacío son un guión", () => {
    expect(comoToneladas(0)).toBe("—");
    expect(comoToneladas(null)).toBe("—");
    expect(comoToneladas(undefined)).toBe("—");
  });
});

describe("comoFecha", () => {
  it("da vuelta el ISO a d/m/a", () => {
    expect(comoFecha("2026-11-12")).toBe("12/11/2026");
  });

  it("tolera un timestamp y se queda con el día", () => {
    expect(comoFecha("2026-11-12T15:04:05.000Z")).toBe("12/11/2026");
  });

  it("vacío es un guión y lo que no es fecha se muestra como vino", () => {
    expect(comoFecha(null)).toBe("—");
    expect(comoFecha("")).toBe("—");
    expect(comoFecha("ayer")).toBe("ayer");
  });
});

describe("nombreDelTipo", () => {
  it("traduce los seis tipos", () => {
    expect(nombreDelTipo("whatsapp")).toBe("WhatsApp");
    expect(nombreDelTipo("reunion")).toBe("Reunión");
  });

  it("uno que no se reconoce se muestra como vino, y no en blanco", () => {
    expect(nombreDelTipo("paloma")).toBe("paloma");
  });
});
