import { describe, it, expect } from "vitest";
import { armarBorradorDeFactura, type DatosParaElBorrador } from "./borradorEnOdoo";

/*
 * Los números de acá salen de una factura real del buzón —PEDRO H. CAMINO,
 * $95.080,59— y de la que cargó el usuario para probar. Con esos valores se creó
 * una factura de verdad en el Odoo de staging y se la borró: el borrador quedó
 * en $95.080,59 exactos, con la cuenta de gasto y la de IVA que pone Odoo.
 */

const CONTEXTO = {
  partnerId: 977,
  diarioId: 11,
  impuestoId: 4,
  monedaId: 19,
  // `voucher.type` id 1 = code 1 = FACTURAS A, que es el código de ARCA del QR.
  voucherTypeId: 1,
};

const FACTURA: DatosParaElBorrador = {
  cuit_emisor: "20165811640",
  tipo_comprobante: 1,
  punto_venta: 6,
  numero: 10192,
  fecha: "2026-09-10",
  importe_total: 95080.59,
  moneda: "ARS",
};

function armar(cambios: Partial<DatosParaElBorrador> = {}, contexto = {}) {
  const r = armarBorradorDeFactura({ ...FACTURA, ...cambios }, { ...CONTEXTO, ...contexto });
  if (!r.ok) throw new Error(`no se armó: ${r.problemas.join(" ")}`);
  return r.borrador;
}

function linea(borrador: ReturnType<typeof armar>) {
  const [[, , valores]] = borrador.vals.invoice_line_ids as [[number, number, Record<string, unknown>]];
  return valores;
}

describe("el borrador de factura que se crea en Odoo", () => {
  it("una factura A lleva el neto y el IVA aparte", () => {
    const borrador = armar();
    // 95.080,59 / 1,21 = 78.579 exacto.
    expect(borrador.neto).toBe(78579);
    expect(borrador.totalEsperado).toBe(95080.59);
    expect(linea(borrador).tax_ids).toEqual([[6, 0, [4]]]);
  });

  it("una factura C va entera, sin impuesto", () => {
    // Medido: de las 4 facturas C cargadas en el grupo, ninguna tiene impuesto.
    // El monotributista no discrimina IVA y ponérselo sería inventar un crédito
    // fiscal que no existe.
    const borrador = armar({ tipo_comprobante: 11 });
    expect(borrador.neto).toBe(95080.59);
    expect(linea(borrador).tax_ids).toEqual([[6, 0, []]]);
  });

  it("una factura B lleva IVA, que es como las carga el grupo", () => {
    expect(armar({ tipo_comprobante: 6 }).neto).toBe(78579);
  });

  it("un tipo de comprobante desconocido no inventa impuesto", () => {
    // Llega hasta acá sólo si Odoo conoce el código aunque el SdG no le sepa la
    // letra. Sin letra no hay IVA: el borrador sale por el total.
    expect(armar({ tipo_comprobante: 88 }).neto).toBe(95080.59);
  });

  it("sin impuesto configurado en la empresa, el borrador sale sin IVA en vez de no salir", () => {
    const borrador = armar({}, { impuestoId: null });
    expect(borrador.neto).toBe(95080.59);
    expect(linea(borrador).tax_ids).toEqual([[6, 0, []]]);
  });

  it("el número va en su campo propio, con cuatro y ocho dígitos", () => {
    expect(armar().vals.voucher_name).toBe("0006-00010192");
    expect(armar().vals.voucher_type_id).toBe(1);
  });

  it("no toca `ref`: ahí administración escribe sus notas", () => {
    expect(armar().vals).not.toHaveProperty("ref");
  });

  it("una nota de crédito es un in_refund", () => {
    expect(armar({ tipo_comprobante: 3 }).tipo).toBe("in_refund");
    expect(armar().tipo).toBe("in_invoice");
  });

  it("reemplaza los impuestos en vez de sumarlos", () => {
    // Sin el 6, Odoo deja además el impuesto por defecto y la factura totaliza
    // de más.
    const ids = linea(armar()).tax_ids as [number, number, number[]][];
    expect(ids[0][0]).toBe(6);
  });

  it("la línea nombra el comprobante en castellano, y el RI cuando lo hay", () => {
    expect(linea(armar()).name).toBe("Factura A 0006-00010192");
    expect(linea(armar({}, { nroRi: 1933 })).name).toBe("Factura A 0006-00010192 · RI 1933");
  });

  it("manda la empresa, el diario y la moneda explícitos", () => {
    const v = armar().vals;
    expect(v.journal_id).toBe(11);
    expect(v.currency_id).toBe(19);
    expect(v.invoice_date).toBe("2026-09-10");
    expect(v.partner_id).toBe(977);
  });

  it("el importe de una nota de crédito va positivo, como lo espera Odoo", () => {
    expect(armar({ tipo_comprobante: 3, importe_total: -95080.59 }).neto).toBe(78579);
  });

  it("redondea a dos decimales, que es lo que Odoo guarda en price_unit", () => {
    // La factura que el usuario cargó al buzón. Con estos valores se creó una
    // factura de verdad en staging: Odoo devolvió neto 1.466.699,26 + IVA
    // 308.006,84 = 1.774.706,10, o sea exactamente lo que dice el comprobante.
    const borrador = armar({ importe_total: 1774706.1 });
    expect(borrador.neto).toBe(1466699.26);
    expect(borrador.totalEsperado).toBe(1774706.1);
  });
});

describe("lo que impide armar el borrador", () => {
  it("sin fecha no se manda: sería un borrador que alguien tiene que completar igual", () => {
    const r = armarBorradorDeFactura({ ...FACTURA, fecha: null }, CONTEXTO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]).toContain("fecha");
  });

  it("sin importe tampoco", () => {
    const r = armarBorradorDeFactura({ ...FACTURA, importe_total: null }, CONTEXTO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]).toContain("importe");
  });

  it("sin número no hay con qué reconocerla después", () => {
    const r = armarBorradorDeFactura({ ...FACTURA, punto_venta: null, numero: null }, CONTEXTO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]).toContain("identifica");
  });

  /*
   * Éste lo enseñó Odoo, no el diseño: un borrador sin tipo de comprobante se
   * crea igual y muere al postearlo con "El documento no tiene numero!". O sea
   * que quedaría un borrador trabado que alguien tiene que descubrir.
   */
  it("sin tipo de comprobante no se manda: el borrador no se podría postear", () => {
    const r = armarBorradorDeFactura(FACTURA, { ...CONTEXTO, voucherTypeId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]).toContain("postear");
  });

  it("junta todos los motivos en vez de contar el primero", () => {
    const r = armarBorradorDeFactura(
      { ...FACTURA, fecha: null, importe_total: null, numero: null },
      { ...CONTEXTO, voucherTypeId: null }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas).toHaveLength(4);
  });
});
