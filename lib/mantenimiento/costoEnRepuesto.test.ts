import { describe, expect, it } from "vitest";
import { textoDeRepuesto, repuestoSinElCosto } from "./costoEnRepuesto";

describe("textoDeRepuesto", () => {
  it("el monto se escribe como ya se escribe a mano", () => {
    expect(textoDeRepuesto(920000, null)).toBe("$920.000");
  });

  it("si ya hay un repuesto, el monto se suma y no lo pisa", () => {
    expect(textoDeRepuesto(240000, "2 parches de 200"))
      .toBe("2 parches de 200 ($240.000)");
  });

  it("sin costo devuelve lo que habia", () => {
    expect(textoDeRepuesto(null, "Paño de zaranda")).toBe("Paño de zaranda");
    expect(textoDeRepuesto(null, null)).toBeNull();
  });

  it("un repuesto en blanco es como no tener ninguno", () => {
    expect(textoDeRepuesto(190000, "   ")).toBe("$190.000");
    expect(textoDeRepuesto(null, "   ")).toBeNull();
  });

  it("un costo en cero no es un precio: no escribe $0", () => {
    expect(textoDeRepuesto(0, null)).toBeNull();
    expect(textoDeRepuesto(0, "Paño de zaranda")).toBe("Paño de zaranda");
  });

  it("los miles llevan punto siempre, tambien los de cuatro cifras", () => {
    // `Intl` con es-AR no agrupa los de cuatro cifras («1000»), y en una
    // columna de montos eso se lee como otro formato.
    expect(textoDeRepuesto(1000, null)).toBe("$1.000");
    expect(textoDeRepuesto(1234567, null)).toBe("$1.234.567");
  });

  it("los centavos van con coma", () => {
    expect(textoDeRepuesto(1234.5, null)).toBe("$1.234,5");
    expect(textoDeRepuesto(100.25, null)).toBe("$100,25");
  });

  it("no deja decimales de punto flotante", () => {
    expect(textoDeRepuesto(0.1 + 0.2 + 1000, null)).toBe("$1.000,3");
  });
});

describe("repuestoSinElCosto", () => {
  it("si el repuesto era sólo el monto, no queda nada", () => {
    expect(repuestoSinElCosto(920000, "$920.000")).toBeNull();
  });

  it("saca el monto que se había sumado al texto", () => {
    expect(repuestoSinElCosto(240000, "2 parches de 200 ($240.000)")).toBe("2 parches de 200");
  });

  it("deshace exactamente lo que hizo textoDeRepuesto", () => {
    for (const [costo, repuesto] of [
      [920000, null], [240000, "2 parches de 200"], [1234.5, "Empalme"],
    ] as const) {
      expect(repuestoSinElCosto(costo, textoDeRepuesto(costo, repuesto))).toBe(repuesto);
    }
  });

  it("si el texto no termina en ese monto, no toca nada", () => {
    // Alguien lo editó a mano en la planilla: no se adivina qué quiso decir.
    expect(repuestoSinElCosto(240000, "Paño de zaranda (RI 230)")).toBe("Paño de zaranda (RI 230)");
    expect(repuestoSinElCosto(240000, "Empalme ($680000)")).toBe("Empalme ($680000)");
  });

  it("sin costo anterior devuelve lo que había", () => {
    expect(repuestoSinElCosto(null, "Paño de zaranda")).toBe("Paño de zaranda");
    expect(repuestoSinElCosto(null, null)).toBeNull();
    expect(repuestoSinElCosto(0, "Paño")).toBe("Paño");
  });
});
