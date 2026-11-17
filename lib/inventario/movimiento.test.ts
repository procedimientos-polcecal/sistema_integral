import { describe, it, expect } from "vitest";
import { loQueFalta, cantidadDelMovimiento, sectorDelMovimiento, stockQueQueda, avisoDeStockNegativo } from "./movimiento";

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
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "7", solicitanteId: "", motivo: "conteo del lunes" })).toEqual([]);
  });

  /**
   * Un ajuste es la unica de las tres que CONTRADICE lo anotado: el stock
   * decia 40 y pasa a decir 12. Sin el porque queda un numero nuevo que nadie
   * puede entender despues. El motivo se guarda en la auditoria.
   */
  it("un ajuste sin motivo no se puede registrar", () => {
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "7", solicitanteId: "" }))
      .toContain("Un ajuste necesita un motivo: qué se encontró al contar.");
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "7", solicitanteId: "", motivo: "   " }))
      .toContain("Un ajuste necesita un motivo: qué se encontró al contar.");
  });

  /** Una entrada y una salida cuentan algo que paso: no necesitan explicacion. */
  it("una entrada y una salida no piden motivo", () => {
    expect(loQueFalta({ ...completo, tipo: "salida" })).toEqual([]);
    expect(loQueFalta({ ...completo, tipo: "entrada" })).toEqual([]);
  });

  /** Vacio no es cero: "no puso nada" y "no hay" son cosas distintas. */
  it("la cantidad vacia falta, y el cero de un ajuste no", () => {
    expect(loQueFalta({ ...completo, cantidad: "" })).toContain("Poné la cantidad.");
    expect(loQueFalta({ ...completo, cantidad: null })).toContain("Poné la cantidad.");
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "" }))
      .toContain("Poné cuánto hay en realidad.");
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "0", solicitanteId: "", motivo: "no quedaba ninguno" })).toEqual([]);
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

describe("en cuanto queda el stock", () => {
  it("una entrada suma y una salida resta", () => {
    expect(stockQueQueda("entrada", 10, 4)).toBe(14);
    expect(stockQueQueda("salida", 10, 4)).toBe(6);
  });

  /** Lo que distingue a un ajuste: no suma ni resta, fija el numero. */
  it("un ajuste fija el numero, no lo suma", () => {
    expect(stockQueQueda("ajuste", 10, 4)).toBe(4);
    expect(stockQueQueda("ajuste", 10, 0)).toBe(0);
  });

  it("sin cantidad todavia no se puede decir nada", () => {
    expect(stockQueQueda("salida", 10, "")).toBeNull();
    expect(stockQueQueda("salida", 10, null)).toBeNull();
    expect(stockQueQueda("salida", 10, undefined)).toBeNull();
    expect(stockQueQueda("salida", 10, "dos")).toBeNull();
  });

  it("la cantidad llega como texto desde el formulario", () => {
    expect(stockQueQueda("salida", 10, "4")).toBe(6);
    expect(stockQueQueda("entrada", 10, "0.5")).toBe(10.5);
  });

  it("una salida mayor al stock da negativo, y se devuelve negativo", () => {
    expect(stockQueQueda("salida", 3, 50)).toBe(-47);
  });
});

describe("el aviso de stock negativo", () => {
  /**
   * El caso que motiva todo: hasta el 22/09/2026 el RPC restaba sin mirar el
   * resultado y la ruta no decia nada. La comprobacion vivia solo en el
   * formulario, con el stock que el navegador tenia cargado.
   */
  it("una salida mayor al stock avisa y dice en cuanto quedo", () => {
    expect(avisoDeStockNegativo(-47)).toContain("-47");
  });

  it("cero no es negativo: no hay nada que avisar", () => {
    expect(avisoDeStockNegativo(0)).toBeNull();
  });

  it("un stock que quedo bien no avisa", () => {
    expect(avisoDeStockNegativo(6)).toBeNull();
  });

  it("sin cantidad cargada no avisa nada", () => {
    expect(avisoDeStockNegativo(null)).toBeNull();
  });

  /** No recorta a cero: el numero negativo es justo lo que hay que ver. */
  it("el aviso dice el numero de verdad y no un cero disimulado", () => {
    expect(avisoDeStockNegativo(-0.5)).toContain("-0.5");
  });
});

/**
 * El bug de la coma decimal, 05/11/2026. El mismo que frenaba la carga de una
 * muestra en Calidad/Ensayos nombrando una malla que estaba escrita en la
 * pantalla: acá decía "Poné la cantidad." sobre un campo lleno.
 *
 * El campo declara `inputMode="decimal"`, así que el teclado del teléfono
 * ofrece la coma; `Number("1,5")` da `NaN` y `Number.isFinite(NaN)` es false,
 * que es el mismo camino que "no pusiste nada".
 */
describe("la cantidad se tipea con coma", () => {
  it("una cantidad con coma decimal no falta", () => {
    expect(loQueFalta({ ...completo, cantidad: "1,5" })).toEqual([]);
    expect(loQueFalta({ ...completo, cantidad: "0,25" })).toEqual([]);
  });

  it("el punto de miles es de miles: 1.200 tornillos son mil doscientos", () => {
    expect(cantidadDelMovimiento("1.200")).toBe(1200);
    expect(cantidadDelMovimiento("1,5")).toBeCloseTo(1.5);
  });

  /** La ruta y el formulario leen con esta misma función: ése era el bug. */
  it("lee igual lo que ya viene como número y lo que no es ninguno", () => {
    expect(cantidadDelMovimiento(3)).toBe(3);
    expect(cantidadDelMovimiento("")).toBeNull();
    expect(cantidadDelMovimiento("dos")).toBeNull();
  });

  it("el stock que queda se calcula con la coma, en vez de desaparecer", () => {
    expect(stockQueQueda("salida", 10, "1,5")).toBeCloseTo(8.5);
    expect(stockQueQueda("entrada", 10, "1.200")).toBe(1210);
    expect(stockQueQueda("ajuste", 10, "2,5")).toBeCloseTo(2.5);
  });

  it("una cantidad con coma sigue respetando el resto de las reglas", () => {
    expect(loQueFalta({ ...completo, cantidad: "-1,5" }))
      .toContain("La cantidad tiene que ser mayor a cero.");
    expect(loQueFalta({ ...completo, tipo: "ajuste", cantidad: "-0,5", solicitanteId: "", motivo: "conteo" }))
      .toContain("El ajuste no puede ser negativo.");
  });
});
