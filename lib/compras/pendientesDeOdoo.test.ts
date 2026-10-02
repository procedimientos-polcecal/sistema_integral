import { describe, it, expect } from "vitest";
import {
  losPendientesDeOdoo,
  ordenesQueGenera,
  resumirPendientes,
  type PendienteDeOdoo,
} from "./pendientesDeOdoo";

const ri = (id: string, extra: Partial<PendienteDeOdoo> = {}): PendienteDeOdoo => ({
  id,
  nro_ri: Number(id),
  fecha: "2026-09-01T00:00:00+00:00",
  descripcion: "algo",
  estado_compra: "PEDIDO",
  proveedor_id: "p-1",
  costo_iva: 1000,
  empresa_id: "e-1",
  paga_ambas: false,
  ...extra,
});

describe("quiénes entran en la pila", () => {
  it("los que están en PEDIDO, con datos y sin orden", () => {
    const r = losPendientesDeOdoo([ri("1")], new Set());
    expect(r.map((x) => x.id)).toEqual(["1"]);
  });

  it("el que ya tiene orden no se manda dos veces", () => {
    expect(losPendientesDeOdoo([ri("1")], new Set(["1"]))).toEqual([]);
  });

  /*
   * Los 1.559 en RECIBIDO quedan afuera a propósito: son 2.146 órdenes y $911
   * millones, y ahí la mercadería ya llegó. Es otra decisión y de otro tamaño.
   */
  it("RECIBIDO no entra, aunque tenga todo", () => {
    expect(losPendientesDeOdoo([ri("1", { estado_compra: "RECIBIDO" })], new Set())).toEqual([]);
  });

  it("sin costo no entra: la orden saldría en cero", () => {
    expect(losPendientesDeOdoo([ri("1", { costo_iva: null })], new Set())).toEqual([]);
  });

  it("sin proveedor tampoco", () => {
    expect(losPendientesDeOdoo([ri("1", { proveedor_id: null })], new Set())).toEqual([]);
  });
});

describe("el corte por fecha", () => {
  const pila = [
    ri("viejo", { fecha: "2025-09-08T00:00:00+00:00" }),
    ri("medio", { fecha: "2026-03-15T00:00:00+00:00" }),
    ri("nuevo", { fecha: "2026-09-12T00:00:00+00:00" }),
  ];

  it("sin corte entran todos", () => {
    expect(losPendientesDeOdoo(pila, new Set())).toHaveLength(3);
  });

  /*
   * El corte existe porque la orden se crea con `date_order` de HOY, no con la
   * del pedido: mandar uno de 2025 le pone fecha de hoy en Odoo.
   */
  it("con corte deja afuera lo anterior", () => {
    const r = losPendientesDeOdoo(pila, new Set(), "2026-01-01");
    expect(r.map((x) => x.id)).toEqual(["nuevo", "medio"]);
  });

  it("el corte es inclusive", () => {
    expect(losPendientesDeOdoo(pila, new Set(), "2026-09-12").map((x) => x.id)).toEqual(["nuevo"]);
  });

  it("uno sin fecha no entra cuando hay corte", () => {
    expect(losPendientesDeOdoo([ri("1", { fecha: null })], new Set(), "2026-01-01")).toEqual([]);
  });
});

/*
 * Si quien manda corta a la mitad, lo que quedó hecho tiene que ser lo que más
 * sirve: el pedido reciente cuya factura todavía no llegó.
 */
describe("el orden en que se mandan", () => {
  it("del más nuevo al más viejo", () => {
    const r = losPendientesDeOdoo(
      [
        ri("a", { fecha: "2025-09-08T00:00:00+00:00" }),
        ri("c", { fecha: "2026-09-12T00:00:00+00:00" }),
        ri("b", { fecha: "2026-03-15T00:00:00+00:00" }),
      ],
      new Set()
    );
    expect(r.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

describe("lo que se muestra antes de apretar", () => {
  /*
   * El número que importa no es cuántos requerimientos son: es cuántas órdenes
   * aparecen en la contabilidad. Los 119 reales son 177 órdenes porque 58 los
   * pagan las dos empresas.
   */
  it("un AMBAS cuenta por dos órdenes", () => {
    expect(ordenesQueGenera({ paga_ambas: true })).toBe(2);
    expect(ordenesQueGenera({ paga_ambas: false })).toBe(1);
  });

  it("el resumen cuenta órdenes, no requerimientos", () => {
    const r = resumirPendientes([
      ri("1", { paga_ambas: true, costo_iva: 1000 }),
      ri("2", { costo_iva: 500 }),
    ]);
    expect(r.requerimientos).toBe(2);
    expect(r.ordenes).toBe(3);
    expect(r.total).toBe(1500);
  });

  it("dice desde cuándo y hasta cuándo va lo que se manda", () => {
    const r = resumirPendientes([
      ri("1", { fecha: "2025-09-08T00:00:00+00:00" }),
      ri("2", { fecha: "2026-09-12T00:00:00+00:00" }),
    ]);
    expect(r.masViejo).toBe("2025-09-08");
    expect(r.masNuevo).toBe("2026-09-12");
  });

  it("una pila vacía se resume en ceros y no en null", () => {
    expect(resumirPendientes([])).toEqual({
      requerimientos: 0,
      ordenes: 0,
      total: 0,
      masViejo: null,
      masNuevo: null,
    });
  });
});
