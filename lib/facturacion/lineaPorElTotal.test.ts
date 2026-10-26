import { describe, expect, it } from "vitest";
import {
  esLaLineaDelTotal,
  lineaPorElTotal,
  lineasParaElBorrador,
} from "./lineaPorElTotal";
import type { LineaDeFactura } from "./lineas";

/** Una línea cualquiera, con lo justo para estas pruebas. */
function linea(total: number, extra: Partial<LineaDeFactura> = {}): LineaDeFactura {
  return {
    id: "l",
    factura_id: "f",
    orden: 0,
    descripcion: "algo",
    cantidad: 1,
    precio_unitario: total,
    total,
    odoo_product_id: null,
    odoo_product_nombre: null,
    odoo_account_id: null,
    odoo_account_nombre: null,
    analitica: null,
    analitica_detalle: null,
    producto_origen: null,
    ...extra,
  } as LineaDeFactura;
}

const AMARAY = {
  tipo_comprobante: 11,
  punto_venta: 3,
  numero: 108,
  importe_total: 1682296.5,
};

describe("la línea del total", () => {
  it("se llama como el comprobante y vale lo que la factura", () => {
    const l = lineaPorElTotal(AMARAY);
    expect(l?.descripcion).toBe("Factura C 0003-00000108");
    expect(l?.cantidad).toBe(1);
    expect(l?.total).toBe(1682296.5);
  });

  /*
   * Guarda el TOTAL y no el neto: el neto depende de si la empresa tiene
   * configurado el IVA, que se sabe recién a la hora del push. En una Factura A
   * son 21 puntos de diferencia.
   */
  it("guarda el total aunque el comprobante discrimine IVA", () => {
    const a = lineaPorElTotal({ ...AMARAY, tipo_comprobante: 1, importe_total: 121 });
    expect(a?.total).toBe(121);
    expect(a?.precio_unitario).toBe(121);
  });

  /*
   * Una fila que dice que la factura vale nada es peor que no tener fila: se
   * puede empujar a Odoo sin que nada avise.
   */
  it("sin importe no se inventa una línea en cero", () => {
    expect(lineaPorElTotal({ ...AMARAY, importe_total: null })).toBeNull();
    expect(lineaPorElTotal({ ...AMARAY, importe_total: 0 })).toBeNull();
  });

  it("no trae producto, cuenta ni analítica: eso lo pone una persona", () => {
    const l = lineaPorElTotal(AMARAY);
    expect(l?.odoo_product_id).toBeNull();
    expect(l?.odoo_account_id).toBeNull();
    expect(l?.analitica).toBeNull();
    expect(l?.producto_origen).toBeNull();
  });
});

describe("reconocerla entre las guardadas", () => {
  it("una sola línea que vale lo mismo que la factura", () => {
    expect(esLaLineaDelTotal([linea(1000)], 1000)).toBe(true);
  });

  it("con un centavo de diferencia sigue siendo ella", () => {
    expect(esLaLineaDelTotal([linea(1000.01)], 1000)).toBe(true);
  });

  it("dos líneas no son la del total, aunque sumen", () => {
    expect(esLaLineaDelTotal([linea(500), linea(500)], 1000)).toBe(false);
  });

  it("una sola línea que vale otra cosa es un detalle de una fila", () => {
    expect(esLaLineaDelTotal([linea(300)], 1000)).toBe(false);
  });

  it("sin líneas, no", () => {
    expect(esLaLineaDelTotal([], 1000)).toBe(false);
  });
});

describe("qué se le pasa al armador del borrador", () => {
  it("el detalle que cuadra va entero", () => {
    const ls = [linea(600), linea(400)];
    expect(lineasParaElBorrador("cuadra", ls, 1000)).toHaveLength(2);
  });

  /*
   * El caso nuevo: antes la regla era `detalle_leido === "cuadra"` y esta línea
   * quedaba afuera por ser de otra categoría, así que el producto y la
   * analítica que alguien le ponía no llegaban nunca a Odoo.
   */
  it("la línea del total va, con lo que le hayan puesto", () => {
    const ls = [linea(1000, { odoo_product_id: 7, odoo_account_id: 9, analitica: { 3: 100 } })];
    const r = lineasParaElBorrador("sin detalle", ls, 1000);
    expect(r).toHaveLength(1);
    expect(r[0].odoo_product_id).toBe(7);
    expect(r[0].analitica).toEqual({ 3: 100 });
  });

  /*
   * Y lo que NO cambió: un detalle que no suma el comprobante no se manda.
   * Armaría un borrador por un importe que no es el de la factura.
   */
  it("el detalle que no cuadra no va, y eso no cambió", () => {
    expect(lineasParaElBorrador("no cuadra", [linea(600), linea(300)], 1000)).toHaveLength(0);
  });

  it("sin detalle y sin líneas tampoco va nada", () => {
    expect(lineasParaElBorrador("sin detalle", [], 1000)).toHaveLength(0);
  });
});
