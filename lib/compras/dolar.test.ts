import { describe, it, expect } from "vitest";
import { leerRespuesta } from "./dolar";

/**
 * Lo que viene de una API externa no se guarda sin mirarlo: esa cotizacion
 * despues congela presupuestos, y un numero inventado ahi no se descubre hasta
 * que llega la factura.
 */
describe("leer la cotizacion de la API", () => {
  it("lee la respuesta buena", () => {
    expect(leerRespuesta({ compra: 1485, venta: 1535 })).toEqual({ compra: 1485, venta: 1535 });
  });

  it("acepta los numeros como texto, que es como a veces vienen", () => {
    expect(leerRespuesta({ compra: "1485", venta: "1535" })?.venta).toBe(1535);
  });

  it("sin venta no sirve: es el valor que se usa", () => {
    expect(leerRespuesta({ compra: 1485 })).toBeNull();
    expect(leerRespuesta({ compra: 1485, venta: null })).toBeNull();
  });

  it("una venta que no es un numero no pasa", () => {
    expect(leerRespuesta({ venta: "no disponible" })).toBeNull();
    expect(leerRespuesta({ venta: 0 })).toBeNull();
    expect(leerRespuesta({ venta: -5 })).toBeNull();
  });

  it("sin compra se usa igual: la venta es la que importa", () => {
    expect(leerRespuesta({ venta: 1535 })).toEqual({ compra: null, venta: 1535 });
  });

  it("una respuesta que no es un objeto no rompe", () => {
    expect(leerRespuesta(null)).toBeNull();
    expect(leerRespuesta("caido")).toBeNull();
    expect(leerRespuesta(undefined)).toBeNull();
  });
});
