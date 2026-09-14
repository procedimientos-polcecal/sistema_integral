import { describe, it, expect } from "vitest";
import { porQueSeSugiere, sugerirCuenta, type HistorialDeCuentas } from "./sugerirCuenta";

/*
 * Los números de acá son de RUBIALES OSCAR FERNANDO, que es el proveedor con más
 * historia de la instancia: 257 líneas a Fletes y Acarreos y 10 a Otros gastos,
 * y su producto FLETE fue 145 veces a Fletes.
 */
const FLETES = "700";
const OTROS = "304";
const REPUESTOS = "706";

const HISTORIAL: HistorialDeCuentas = {
  porProducto: {
    "6835": { [FLETES]: 145 },
    "6909": { [OTROS]: 8, [FLETES]: 2 },
    "7001": { [FLETES]: 1 },
    "7002": { [FLETES]: 3, [OTROS]: 2 },
  },
  delProveedor: { [FLETES]: 257, [OTROS]: 10 },
  nombres: {
    [FLETES]: "5.1.1.01.011 Fletes y Acarreos",
    [OTROS]: "601499000000 Otros gastos de comercializacion",
    [REPUESTOS]: "5.2.1.01.220 Repuestos",
  },
};

describe("la cuenta que se propone para una línea", () => {
  it("sale de lo que este proveedor facturó de este producto", () => {
    const s = sugerirCuenta(6835, HISTORIAL);
    expect(s?.cuentaId).toBe(700);
    expect(s?.nombre).toBe("5.1.1.01.011 Fletes y Acarreos");
    expect(s?.segun).toBe("este proveedor y este producto");
    expect(s?.veces).toBe(145);
  });

  /*
   * El producto manda sobre el promedio del proveedor: la carbonilla de este
   * proveedor va a Otros gastos aunque él facture casi todo a Fletes.
   */
  it("el producto gana sobre el promedio del proveedor", () => {
    const s = sugerirCuenta(6909, HISTORIAL);
    expect(s?.cuentaId).toBe(304);
    expect(s?.segun).toBe("este proveedor y este producto");
  });

  it("sin historia del producto, cae al promedio del proveedor", () => {
    const s = sugerirCuenta(99999, HISTORIAL);
    expect(s?.cuentaId).toBe(700);
    expect(s?.segun).toBe("este proveedor");
  });

  it("una línea sin producto usa igual lo del proveedor", () => {
    expect(sugerirCuenta(null, HISTORIAL)?.cuentaId).toBe(700);
  });

  /*
   * Un solo antecedente no es una costumbre. El producto 7001 fue una vez a
   * Fletes: no alcanza, así que cae al proveedor.
   */
  it("con un solo antecedente no propone por producto", () => {
    const s = sugerirCuenta(7001, HISTORIAL);
    expect(s?.segun).toBe("este proveedor");
  });

  /*
   * 3 de 5 es 60%: por debajo del 0,8 medido. Ahí el producto no decide y manda
   * el proveedor, que sí es firme.
   */
  it("si el producto no es parejo, tampoco: 3 de 5 no alcanza", () => {
    const s = sugerirCuenta(7002, HISTORIAL);
    expect(s?.segun).toBe("este proveedor");
  });

  it("sin historia de nada, no propone", () => {
    const vacio: HistorialDeCuentas = { porProducto: {}, delProveedor: {}, nombres: {} };
    expect(sugerirCuenta(6835, vacio)).toBeNull();
  });

  it("un proveedor que reparte parejo no genera sugerencia", () => {
    const parejo: HistorialDeCuentas = {
      porProducto: {},
      delProveedor: { [FLETES]: 10, [OTROS]: 9 },
      nombres: HISTORIAL.nombres,
    };
    expect(sugerirCuenta(null, parejo)).toBeNull();
  });

  it("una cuenta que ya no está en el catálogo se muestra por su id", () => {
    const rara: HistorialDeCuentas = { porProducto: {}, delProveedor: { "999": 5 }, nombres: {} };
    expect(sugerirCuenta(null, rara)?.nombre).toBe("#999");
  });
});

describe("por qué se sugiere", () => {
  it("dice el antecedente, que es lo que la hace revisable", () => {
    expect(porQueSeSugiere(sugerirCuenta(6909, HISTORIAL)!)).toBe(
      "8 de 10 veces fue a esta cuenta, según este proveedor y este producto"
    );
  });

  it("cuando fueron todas, lo dice así y no '145 de 145'", () => {
    expect(porQueSeSugiere(sugerirCuenta(6835, HISTORIAL)!)).toBe(
      "las 145 veces anteriores fue a esta cuenta, según este proveedor y este producto"
    );
  });
});
