import { describe, it, expect } from "vitest";
import {
  agruparPorArticulo,
  buscarEnComparativas,
  type CotizacionHistorica,
} from "./buscadorDeComparativas";

function cotizacion(parcial: Partial<CotizacionHistorica> = {}): CotizacionHistorica {
  return {
    id: "c1",
    requerimientoId: "r1",
    nroRi: 100,
    descripcion: "CORREA C-153",
    claveArticulo: "CORREA C 153",
    fecha: "2026-06-02",
    proveedorId: "p1",
    proveedor: "Todo Ruleman",
    marca: "SKF",
    moneda: "ARS",
    precioUnitario: 1000,
    precioTotal: 1210,
    cantidad: 1,
    unidadMedida: "X U",
    condicionesPago: "CTA CTE",
    disponibilidad: "Inmediata",
    planillaId: "drive-1",
    planillaNombre: "CORREAS",
    ...parcial,
  };
}

describe("buscarEnComparativas", () => {
  it("sin filtros devuelve todo", () => {
    const filas = [cotizacion(), cotizacion({ id: "c2" })];
    expect(buscarEnComparativas(filas, {})).toHaveLength(2);
  });

  it("encuentra por descripción ignorando acentos y orden de palabras", () => {
    const filas = [
      cotizacion({ id: "c1", descripcion: "Bolsón de cal hidratada", claveArticulo: "BOLSON DE CAL HIDRATADA" }),
      cotizacion({ id: "c2", descripcion: "CORREA C-153", claveArticulo: "CORREA C 153" }),
    ];
    expect(buscarEnComparativas(filas, { texto: "hidratada bolson" }).map((f) => f.id)).toEqual(["c1"]);
  });

  /*
   * La marca entra a la búsqueda de producto a propósito: hay 302 marcas en las
   * cotizaciones importadas, y "SKF" es una forma legítima de buscar un
   * rulemán cuando no se recuerda cómo lo escribió quien cargó el pedido.
   */
  it("encuentra por marca", () => {
    const filas = [
      cotizacion({ id: "c1", marca: "SKF" }),
      cotizacion({ id: "c2", marca: "DONALDSON" }),
    ];
    expect(buscarEnComparativas(filas, { texto: "donaldson" }).map((f) => f.id)).toEqual(["c2"]);
  });

  it("encuentra por número de requerimiento", () => {
    const filas = [cotizacion({ id: "c1", nroRi: 1340 }), cotizacion({ id: "c2", nroRi: 2201 })];
    expect(buscarEnComparativas(filas, { texto: "2201" }).map((f) => f.id)).toEqual(["c2"]);
  });

  it("filtra por proveedor", () => {
    const filas = [
      cotizacion({ id: "c1", proveedorId: "p1" }),
      cotizacion({ id: "c2", proveedorId: "p2" }),
    ];
    expect(buscarEnComparativas(filas, { proveedorId: "p2" }).map((f) => f.id)).toEqual(["c2"]);
  });

  it("los dos filtros se suman", () => {
    const filas = [
      cotizacion({ id: "c1", proveedorId: "p1", descripcion: "CORREA", claveArticulo: "CORREA" }),
      cotizacion({ id: "c2", proveedorId: "p2", descripcion: "CORREA", claveArticulo: "CORREA" }),
      cotizacion({ id: "c3", proveedorId: "p2", descripcion: "FILTRO", claveArticulo: "FILTRO", marca: null }),
    ];
    expect(buscarEnComparativas(filas, { texto: "correa", proveedorId: "p2" }).map((f) => f.id)).toEqual(["c2"]);
  });
});

describe("agruparPorArticulo", () => {
  /*
   * Agrupa por `clave_articulo` y no por la descripción: la clave es la
   * descripción normalizada, y es lo que hace que "CORREA C-153" y
   * "Correa C 153" sean el mismo artículo. Medido el 26/11/2026: 1.078
   * cotizaciones sobre 840 artículos, de los que 139 tienen dos o más.
   */
  it("junta las cotizaciones del mismo artículo aunque se escriba distinto", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "c1", descripcion: "CORREA C-153", claveArticulo: "CORREA C 153", nroRi: 100 }),
      cotizacion({ id: "c2", descripcion: "Correa C 153", claveArticulo: "CORREA C 153", nroRi: 200 }),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].veces).toBe(2);
  });

  /** La descripción que se muestra es la del pedido más nuevo, no la primera. */
  it("muestra la descripción del pedido más nuevo", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "c1", descripcion: "vieja", claveArticulo: "X", nroRi: 100 }),
      cotizacion({ id: "c2", descripcion: "nueva", claveArticulo: "X", nroRi: 200 }),
    ]);
    expect(grupos[0].descripcion).toBe("nueva");
  });

  it("ordena las cotizaciones del grupo de la más nueva a la más vieja", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "vieja", claveArticulo: "X", nroRi: 100 }),
      cotizacion({ id: "nueva", claveArticulo: "X", nroRi: 300 }),
      cotizacion({ id: "media", claveArticulo: "X", nroRi: 200 }),
    ]);
    expect(grupos[0].cotizaciones.map((c) => c.id)).toEqual(["nueva", "media", "vieja"]);
  });

  it("ordena los grupos por su cotización más nueva", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "a", claveArticulo: "A", nroRi: 100 }),
      cotizacion({ id: "b", claveArticulo: "B", nroRi: 500 }),
    ]);
    expect(grupos.map((g) => g.clave)).toEqual(["B", "A"]);
  });

  /*
   * Cotizaciones y pedidos no son lo mismo, y confundirlos fue el primer bug
   * de esta pantalla. Medido el 26/11/2026 contra la base: el artículo más
   * cotizado tiene 9 cotizaciones que son **todas del RI 1865** —una
   * comparativa de verdad entre dos proveedores— mientras que «Filtro aceite
   * motor» tiene 8 repartidas en pedidos distintos a lo largo de siete meses,
   * que es historial. Son 139 artículos con 2+ cotizaciones contra 119 con 2+
   * pedidos: los 20 de diferencia son los que se pidieron una sola vez.
   */
  it("cuenta los pedidos distintos, que no son las cotizaciones", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "c1", claveArticulo: "X", requerimientoId: "r1", nroRi: 10 }),
      cotizacion({ id: "c2", claveArticulo: "X", requerimientoId: "r1", nroRi: 10 }),
      cotizacion({ id: "c3", claveArticulo: "X", requerimientoId: "r2", nroRi: 20 }),
    ]);
    expect(grupos[0].veces).toBe(3);
    expect(grupos[0].pedidos).toBe(2);
  });

  it("cuenta cuántos proveedores distintos cotizaron el artículo", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "c1", claveArticulo: "X", proveedorId: "p1" }),
      cotizacion({ id: "c2", claveArticulo: "X", proveedorId: "p1" }),
      cotizacion({ id: "c3", claveArticulo: "X", proveedorId: "p2" }),
    ]);
    expect(grupos[0].proveedores).toBe(2);
  });

  it("da el rango de precio unitario del artículo", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "c1", claveArticulo: "X", precioUnitario: 100 }),
      cotizacion({ id: "c2", claveArticulo: "X", precioUnitario: 450 }),
      cotizacion({ id: "c3", claveArticulo: "X", precioUnitario: 300 }),
    ]);
    expect(grupos[0].rango).toEqual({ moneda: "ARS", minimo: 100, maximo: 450 });
  });

  /*
   * Un grupo que mezcla monedas no tiene rango, y eso no es un detalle
   * teórico: de los 840 artículos cotizados hay uno así, porque la base tiene
   * una sola cotización en dólares entre 1.078. Un mínimo que compara 1.000
   * pesos con 1.000 dólares no está incompleto, está mal — y es la misma regla
   * que el embudo del CRM, donde el monto no se convierte nunca.
   */
  it("no arma rango cuando el artículo mezcla monedas", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "c1", claveArticulo: "X", moneda: "ARS", precioUnitario: 100 }),
      cotizacion({ id: "c2", claveArticulo: "X", moneda: "USD", precioUnitario: 450 }),
    ]);
    expect(grupos[0].rango).toBeNull();
  });

  it("ignora las cotizaciones sin precio al armar el rango", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "c1", claveArticulo: "X", precioUnitario: null }),
      cotizacion({ id: "c2", claveArticulo: "X", precioUnitario: 250 }),
    ]);
    expect(grupos[0].rango).toEqual({ moneda: "ARS", minimo: 250, maximo: 250 });
  });

  it("sin ninguna cotización con precio no hay rango", () => {
    const grupos = agruparPorArticulo([
      cotizacion({ id: "c1", claveArticulo: "X", precioUnitario: null }),
    ]);
    expect(grupos[0].rango).toBeNull();
  });

  it("de una lista vacía no salen grupos", () => {
    expect(agruparPorArticulo([])).toEqual([]);
  });
});
