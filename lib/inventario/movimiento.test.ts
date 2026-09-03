import { describe, it, expect } from "vitest";
import { loQueFalta, sectorDelMovimiento } from "./movimiento";

const completo = {
  articuloId: "a-1",
  tipo: "salida" as const,
  cantidad: "3",
  solicitanteId: "e-1",
};

describe("que le falta a un movimiento para poder registrarse", () => {
  it("con articulo, cantidad y quien lo pidio no falta nada", () => {
    expect(loQueFalta(completo)).toEqual([]);
  });

  it("sin articulo no hay movimiento", () => {
    expect(loQueFalta({ ...completo, articuloId: null })).toContain("Elegí el artículo.");
    expect(loQueFalta({ ...completo, articuloId: "  " })).toContain("Elegí el artículo.");
  });

  /**
   * La columna F del kardex viene llena en 3.793 de 3.794 filas. Dejarla vacia
   * desde la app seria empeorar un documento que hoy esta completo.
   */
  it("una entrada y una salida piden quien lo pidio", () => {
    expect(loQueFalta({ ...completo, solicitanteId: "" })).toContain("Falta quién lo pidió.");
    expect(loQueFalta({ ...completo, tipo: "entrada", solicitanteId: null }))
      .toContain("Falta quién lo pidió.");
  });

  /** Un ajuste no lo pide nadie: es alguien contando de nuevo. */
  it("un ajuste no pide quien lo pidio", () => {
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "7", solicitanteId: "" })).toEqual([]);
  });

  /** Vacio no es cero: "no puso nada" y "no hay" son cosas distintas. */
  it("la cantidad vacia falta, y el cero de un ajuste no", () => {
    expect(loQueFalta({ ...completo, cantidad: "" })).toContain("Poné la cantidad.");
    expect(loQueFalta({ ...completo, cantidad: null })).toContain("Poné la cantidad.");
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "" }))
      .toContain("Poné cuánto hay en realidad.");
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "0", solicitanteId: "" })).toEqual([]);
  });

  it("una salida de cero o negativa no es una salida", () => {
    expect(loQueFalta({ ...completo, cantidad: "0" }))
      .toContain("La cantidad tiene que ser mayor a cero.");
    expect(loQueFalta({ ...completo, cantidad: "-2" }))
      .toContain("La cantidad tiene que ser mayor a cero.");
  });

  it("un ajuste negativo no existe", () => {
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "-1" }))
      .toContain("El ajuste no puede ser negativo.");
  });

  it("lo que no es un numero falta igual que lo vacio", () => {
    expect(loQueFalta({ ...completo, cantidad: "dos" })).toContain("Poné la cantidad.");
  });

  it("junta todo lo que falta, no lo primero", () => {
    expect(loQueFalta({ articuloId: "", tipo: "salida", cantidad: "", solicitanteId: "" }))
      .toHaveLength(3);
  });
});

describe("de donde sale el destino", () => {
  it("sin elegir nada, el de quien retira", () => {
    expect(sectorDelMovimiento("", "s-mant")).toBe("s-mant");
    expect(sectorDelMovimiento(null, "s-mant")).toBe("s-mant");
  });

  /** Todo el punto de poder elegirlo: el material lo retira el mecanico para
   * una maquina de Filler 2, y eso solo lo sabe quien esta ahi. */
  it("lo elegido a mano pisa al de quien retira", () => {
    expect(sectorDelMovimiento("s-filler2", "s-mant")).toBe("s-filler2");
  });

  it("sin quien retira y sin eleccion queda en null, no en un parecido", () => {
    expect(sectorDelMovimiento("", null)).toBeNull();
    expect(sectorDelMovimiento(null, undefined)).toBeNull();
    expect(sectorDelMovimiento("  ", "  ")).toBeNull();
  });

  it("alguien sin destino en la lista no impide elegirlo a mano", () => {
    expect(sectorDelMovimiento("s-panol", null)).toBe("s-panol");
  });
});
