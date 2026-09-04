import { describe, it, expect } from "vitest";
import { armarOrdenes } from "./ordenDeCompra";
import type {
  ContextoDeOdoo,
  CotizacionParaOrden,
  EmpresaParaOrden,
  RequerimientoParaOrden,
} from "./ordenDeCompra";

/**
 * Lo que se protege acá es lo que se le manda a la contabilidad de otra empresa.
 * Los ids son los reales de la base de Odoo del grupo (empresas 1 y 2, monedas
 * ARS 19 y USD 1, picking types 1 y 8), leídos el 03/09/2026.
 */

const CONTEXTO: ContextoDeOdoo = {
  monedas: { ARS: 19, USD: 1 },
  ahora: new Date("2026-09-04T12:30:00.000Z"),
};

const POLCECAL: EmpresaParaOrden = {
  id: "uuid-polcecal",
  nombre: "POLCECAL",
  odooCompanyId: 1,
  odooPartnerId: 977,
  pickingTypeId: 1,
};

const POLYSAN: EmpresaParaOrden = {
  id: "uuid-polysan",
  nombre: "POLYSAN",
  odooCompanyId: 2,
  odooPartnerId: 2190,
  pickingTypeId: 8,
};

function ri(extra: Partial<RequerimientoParaOrden> = {}): RequerimientoParaOrden {
  return {
    nroRi: 1234,
    descripcion: "Rulemán 6205 2RS",
    codigo: null,
    cantidad: 4,
    empresaId: "uuid-polcecal",
    pagaAmbas: false,
    fechaNecesidad: null,
    ...extra,
  };
}

function cotizacion(extra: Partial<CotizacionParaOrden> = {}): CotizacionParaOrden {
  return {
    precioUnitario: 1000,
    cantidad: 4,
    descuento: null,
    costoEnvio: null,
    moneda: "ARS",
    ...extra,
  };
}

/** Las líneas, ya desenvueltas del `[0, 0, {...}]` que espera Odoo. */
function lineas(vals: Record<string, unknown>) {
  return (vals.order_line as [number, number, Record<string, unknown>][]).map((l) => l[2]);
}

describe("una orden, una empresa", () => {
  it("manda los campos que Odoo exige, con los ids de la empresa", () => {
    const r = armarOrdenes(ri(), cotizacion(), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("debería haber armado la orden");

    expect(r.ordenes).toHaveLength(1);
    const { vals, porcentaje } = r.ordenes[0];
    expect(porcentaje).toBe(100);
    expect(vals).toMatchObject({
      partner_id: 977,
      company_id: 1,
      currency_id: 19,
      picking_type_id: 1,
      origin: "RI 1234",
    });
  });

  it("la fecha va como la quiere Odoo, sin T ni Z", () => {
    const r = armarOrdenes(ri(), cotizacion(), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    // `toISOString()` daría "2026-09-04T12:30:00.000Z" y Odoo lo rechaza.
    expect(r.ordenes[0].vals.date_order).toBe("2026-09-04 12:30:00");
  });

  it("una línea con la descripción, la cantidad y el precio", () => {
    const r = armarOrdenes(ri(), cotizacion(), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    expect(lineas(r.ordenes[0].vals)).toEqual([
      { name: "Rulemán 6205 2RS", product_qty: 4, price_unit: 1000 },
    ]);
  });

  it("el código del SdG va adelante de la descripción cuando existe", () => {
    const r = armarOrdenes(ri({ codigo: "RUL-6205" }), cotizacion(), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    expect(lineas(r.ordenes[0].vals)[0].name).toBe("[RUL-6205] Rulemán 6205 2RS");
  });

  it("el descuento pasa de fracción a porcentaje", () => {
    // El SdG guarda 0.10; Odoo espera 10.
    const r = armarOrdenes(ri(), cotizacion({ descuento: 0.1 }), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    expect(lineas(r.ordenes[0].vals)[0].discount).toBe(10);
  });

  it("sin descuento no se manda el campo, en vez de mandar cero", () => {
    const r = armarOrdenes(ri(), cotizacion(), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    expect(lineas(r.ordenes[0].vals)[0]).not.toHaveProperty("discount");
  });

  it("el flete va como línea aparte, no sumado al precio", () => {
    const r = armarOrdenes(ri(), cotizacion({ costoEnvio: 5000 }), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    const l = lineas(r.ordenes[0].vals);
    expect(l).toHaveLength(2);
    expect(l[1]).toEqual({ name: "Flete", product_qty: 1, price_unit: 5000 });
  });

  it("una cotización en dólares usa la moneda de Odoo, no la de la empresa", () => {
    // Existen 16 órdenes en USD en la base, así que no es hipotético.
    const r = armarOrdenes(ri(), cotizacion({ moneda: "USD" }), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    expect(r.ordenes[0].vals.currency_id).toBe(1);
  });

  it("la fecha de necesidad viaja como datetime", () => {
    const r = armarOrdenes(
      ri({ fechaNecesidad: "2026-09-20" }),
      cotizacion(),
      [POLCECAL],
      CONTEXTO
    );
    if (!r.ok) throw new Error("no armó");

    expect(r.ordenes[0].vals.date_planned).toBe("2026-09-20 00:00:00");
  });

  it("el impuesto se manda sólo si se decidió cuál", () => {
    const sin = armarOrdenes(ri(), cotizacion(), [POLCECAL], CONTEXTO);
    if (!sin.ok) throw new Error("no armó");
    expect(lineas(sin.ordenes[0].vals)[0]).not.toHaveProperty("taxes_id");

    const con = armarOrdenes(ri(), cotizacion(), [POLCECAL], { ...CONTEXTO, impuestoId: 42 });
    if (!con.ok) throw new Error("no armó");
    expect(lineas(con.ordenes[0].vals)[0].taxes_id).toEqual([[6, 0, [42]]]);
  });
});

describe("un requerimiento que pagan las dos", () => {
  const compartido = ri({ empresaId: null, pagaAmbas: true, cantidad: 4 });

  it("son dos órdenes, una por empresa, al 50%", () => {
    const r = armarOrdenes(compartido, cotizacion(), [POLCECAL, POLYSAN], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    expect(r.ordenes).toHaveLength(2);
    expect(r.ordenes.map((o) => [o.empresaNombre, o.vals.company_id, o.porcentaje])).toEqual([
      ["POLCECAL", 1, 50],
      ["POLYSAN", 2, 50],
    ]);
  });

  it("cada orden lleva la mitad de la cantidad, con el precio unitario intacto", () => {
    const r = armarOrdenes(compartido, cotizacion(), [POLCECAL, POLYSAN], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    for (const orden of r.ordenes) {
      expect(lineas(orden.vals)[0]).toMatchObject({ product_qty: 2, price_unit: 1000 });
    }
  });

  it("el flete con centavos impares no inventa un centavo", () => {
    const r = armarOrdenes(
      compartido,
      cotizacion({ costoEnvio: 100.01 }),
      [POLCECAL, POLYSAN],
      CONTEXTO
    );
    if (!r.ok) throw new Error("no armó");

    const fletes = r.ordenes.map((o) => lineas(o.vals)[1].price_unit as number);
    // Darle la misma parte a las dos daría 50,01 + 50,01 = 100,02.
    expect(fletes).toEqual([50.01, 50]);
    expect(Math.round(fletes[0] * 100) + Math.round(fletes[1] * 100)).toBe(10001);
  });

  it("el origen aclara que es una de dos, para que no parezcan duplicadas", () => {
    const r = armarOrdenes(compartido, cotizacion(), [POLCECAL, POLYSAN], CONTEXTO);
    if (!r.ok) throw new Error("no armó");

    expect(r.ordenes[0].vals.origin).toBe("RI 1234 (50% POLCECAL)");
    expect(r.ordenes[1].vals.origin).toBe("RI 1234 (50% POLYSAN)");
  });

  it("una cantidad impar queda fraccionada: es la consecuencia conocida", () => {
    const r = armarOrdenes(
      ri({ empresaId: null, pagaAmbas: true, cantidad: 3 }),
      cotizacion({ cantidad: 3 }),
      [POLCECAL, POLYSAN],
      CONTEXTO
    );
    if (!r.ok) throw new Error("no armó");

    for (const orden of r.ordenes) {
      expect(lineas(orden.vals)[0].product_qty).toBe(1.5);
    }
  });
});

describe("cuando no se puede armar", () => {
  it("si el proveedor no existe en una empresa, no se arma NINGUNA orden", () => {
    const polysanSinProveedor = { ...POLYSAN, odooPartnerId: null };
    const r = armarOrdenes(
      ri({ empresaId: null, pagaAmbas: true }),
      cotizacion(),
      [POLCECAL, polysanSinProveedor],
      CONTEXTO
    );

    // Media compra es peor que ninguna: una orden por el 50% y la otra mitad
    // en ningún lado, sin que nadie la vea incompleta.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0].tipo).toBe("sin proveedor enlazado");
  });

  it("el mensaje del proveedor faltante dice qué hacer y en qué empresa", () => {
    const r = armarOrdenes(ri(), cotizacion(), [{ ...POLCECAL, odooPartnerId: null }], CONTEXTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;

    expect(r.problemas[0].detalle).toContain("POLCECAL");
    expect(r.problemas[0].detalle).toContain("de alta");
    // Lo que no tiene que decir: "error al crear la orden".
    expect(r.problemas[0].detalle).not.toMatch(/error/i);
  });

  it("sin precio no se arma", () => {
    const r = armarOrdenes(ri(), cotizacion({ precioUnitario: null }), [POLCECAL], CONTEXTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.map((p) => p.tipo)).toContain("sin precio");
  });

  it("un precio en cero tampoco: sería una orden por nada", () => {
    const r = armarOrdenes(ri(), cotizacion({ precioUnitario: 0 }), [POLCECAL], CONTEXTO);
    expect(r.ok).toBe(false);
  });

  it("sin cantidad en ningún lado no se arma", () => {
    const r = armarOrdenes(
      ri({ cantidad: null }),
      cotizacion({ cantidad: null }),
      [POLCECAL],
      CONTEXTO
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.map((p) => p.tipo)).toContain("sin cantidad");
  });

  it("la cantidad de la cotización manda sobre la del requerimiento", () => {
    // Es la que el proveedor presupuestó de verdad.
    const r = armarOrdenes(ri({ cantidad: 4 }), cotizacion({ cantidad: 6 }), [POLCECAL], CONTEXTO);
    if (!r.ok) throw new Error("no armó");
    expect(lineas(r.ordenes[0].vals)[0].product_qty).toBe(6);
  });

  it("una moneda que Odoo no tiene se informa, no se cambia por pesos", () => {
    const r = armarOrdenes(ri(), cotizacion({ moneda: "EUR" }), [POLCECAL], CONTEXTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas[0].tipo).toBe("moneda desconocida");
  });

  it("sin empresas no se arma nada", () => {
    const r = armarOrdenes(ri({ empresaId: null }), cotizacion(), [], CONTEXTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.map((p) => p.tipo)).toContain("sin empresa");
  });

  it("junta todos los problemas en vez de morir en el primero", () => {
    const r = armarOrdenes(
      ri({ cantidad: null }),
      cotizacion({ precioUnitario: null, cantidad: null, moneda: "EUR" }),
      [{ ...POLCECAL, odooPartnerId: null }],
      CONTEXTO
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;

    // Quien lo lee arregla las cuatro cosas de una, no una por intento.
    expect(r.problemas).toHaveLength(4);
  });
});
