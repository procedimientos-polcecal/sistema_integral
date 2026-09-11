import { describe, it, expect } from "vitest";
import {
  PRECIO_SIMBOLICO,
  valoresDeLaOrdenDeRecepcion,
  origenDeLaRecepcion,
} from "./ordenDeCarbonilla";

const datos = {
  odooPartnerId: 1054,
  odooCompanyId: 1,
  pickingTypeId: 7,
  productoId: 6909,
  uomId: 12,
  impuestoId: 33,
  monedaId: 19,
  toneladas: 19.79,
  fecha: "2026-09-11",
  descripcion: "CARBONILLA",
  origen: "Recepción SdG 11/9/2026",
};

describe("valoresDeLaOrdenDeRecepcion", () => {
  it("arma una sola línea, con la cantidad pesada y la unidad explícita", () => {
    const vals = valoresDeLaOrdenDeRecepcion(datos);
    const lineas = vals.order_line as [number, number, Record<string, unknown>][];
    expect(lineas).toHaveLength(1);
    const [comando, cero, linea] = lineas[0];
    expect([comando, cero]).toEqual([0, 0]);
    expect(linea.product_id).toBe(6909);
    expect(linea.product_qty).toBe(19.79);
    expect(linea.product_uom).toBe(12);
  });

  /**
   * El precio no es un precio: se midió que la orden nace simbólica y la factura
   * la reprecia. Si algún día alguien lo sube a un número creíble, este test se
   * cae y hay que leer el spec antes de cambiarlo.
   */
  it("el precio es simbólico y es un peso", () => {
    const linea = (valoresDeLaOrdenDeRecepcion(datos).order_line as [number, number, Record<string, unknown>][])[0][2];
    expect(linea.price_unit).toBe(PRECIO_SIMBOLICO);
    expect(PRECIO_SIMBOLICO).toBe(1);
  });

  it("la empresa, el partner y el tipo de operación van tal cual llegan", () => {
    const vals = valoresDeLaOrdenDeRecepcion(datos);
    expect(vals.partner_id).toBe(1054);
    expect(vals.company_id).toBe(1);
    expect(vals.picking_type_id).toBe(7);
    expect(vals.currency_id).toBe(19);
  });

  /** Odoo exige `date_planned` en toda línea, y la recepción ya ocurrió. */
  it("las dos fechas son la del día de la recepción", () => {
    const vals = valoresDeLaOrdenDeRecepcion(datos);
    const linea = (vals.order_line as [number, number, Record<string, unknown>][])[0][2];
    expect(vals.date_order).toBe("2026-09-11 12:00:00");
    expect(linea.date_planned).toBe("2026-09-11 12:00:00");
  });

  it("sin IVA configurado la línea sale sin impuesto, no con uno inventado", () => {
    const linea = (
      valoresDeLaOrdenDeRecepcion({ ...datos, impuestoId: null })
        .order_line as [number, number, Record<string, unknown>][]
    )[0][2];
    expect(linea.taxes_id).toEqual([[6, 0, []]]);
  });

  it("con IVA, va el de la empresa", () => {
    const linea = (valoresDeLaOrdenDeRecepcion(datos).order_line as [number, number, Record<string, unknown>][])[0][2];
    expect(linea.taxes_id).toEqual([[6, 0, [33]]]);
  });

  /** Sin moneda resuelta no se manda el campo: Odoo usa la de la empresa. */
  it("sin moneda no se manda currency_id", () => {
    expect(valoresDeLaOrdenDeRecepcion({ ...datos, monedaId: null })).not.toHaveProperty("currency_id");
  });
});

describe("origenDeLaRecepcion", () => {
  /**
   * El pesaje viaja en el documento origen porque es el dato que no está en
   * ningún otro lado: si alguien discute la cantidad, el bruto y la tara se leen
   * en Odoo sin entrar al SdG.
   */
  it("dice la fecha y el pesaje que dio esa cantidad", () => {
    expect(origenDeLaRecepcion({ fecha: "2026-09-11", brutoKg: 32400, taraKg: 12610 }))
      .toBe("Recepción SdG 11/9/2026 · bruto 32400 kg − tara 12610 kg");
  });
});
