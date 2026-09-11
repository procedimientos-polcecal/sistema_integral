import { describe, it, expect } from "vitest";
import {
  conciliar,
  estadoSegunOdoo,
  numeroDelVoucher,
  numerosDeLaReferencia,
  type FacturaParaConciliar,
  type MovimientoDeOdoo,
} from "./conciliacion";

/*
 * Las referencias de acá son **textuales** de la instancia del grupo, con sus
 * espacios de más y sus guiones sueltos. Inventarlas prolijas habría probado un
 * problema que no existe: el formato real es el que hay que aguantar.
 */

describe("los números que hay dentro de una referencia de Odoo", () => {
  it("lee la forma normal", () => {
    expect(numerosDeLaReferencia("FC A 00008-00003715")).toEqual([
      { puntoVenta: 8, numero: 3715 },
    ]);
  });

  it("aguanta los espacios de más y el guión suelto que escribe administración", () => {
    expect(numerosDeLaReferencia("FC   A 00008-00003738")).toEqual([
      { puntoVenta: 8, numero: 3738 },
    ]);
    expect(numerosDeLaReferencia("FC A - 00008-00003683 - FC A - 00008-00003691")).toEqual([
      { puntoVenta: 8, numero: 3683 },
      { puntoVenta: 8, numero: 3691 },
    ]);
  });

  it("saca todos los comprobantes cuando una factura de Odoo agrupa varios", () => {
    // 321 de las 1.147 referencias cargadas son así.
    const numeros = numerosDeLaReferencia(
      "FC A 00006-00012761 - FC A 00006-00012846 - FC A 00006-00012778"
    );
    expect(numeros).toHaveLength(3);
    expect(numeros).toContainEqual({ puntoVenta: 6, numero: 12778 });
  });

  it("no le importa si el punto de venta va en cuatro o en cinco dígitos", () => {
    expect(numerosDeLaReferencia("FC A 0005-00026067")).toEqual([
      { puntoVenta: 5, numero: 26067 },
    ]);
  });

  it("encuentra el número dentro de una reversión", () => {
    expect(
      numerosDeLaReferencia("Reversal of: FC A 0022-00002052, ajuste x plazo de pago")
    ).toEqual([{ puntoVenta: 22, numero: 2052 }]);
  });

  it("no inventa nada cuando la referencia es texto libre", () => {
    for (const ref of [
      "COMPRA PAGADA POR MERCADO LIBRE",
      "REMITOS MEMBRANEX FEBRERO 2026",
      "74129, 74130, 74143",
      "chosoico",
      "",
      null,
    ]) {
      expect(numerosDeLaReferencia(ref), String(ref)).toEqual([]);
    }
  });

  it("no repite el mismo número escrito dos veces", () => {
    // Pasa, y es un error de tipeo de quien cargó: no son dos comprobantes.
    expect(
      numerosDeLaReferencia("FC A 00008-00003727 - FC A 00008-00003727")
    ).toHaveLength(1);
  });
});

describe("el número que Odoo guarda en su campo propio", () => {
  it("es punto de venta y número, y nada más", () => {
    expect(numeroDelVoucher("0006-00010192")).toEqual({ puntoVenta: 6, numero: 10192 });
    expect(numeroDelVoucher("0501-00317611")).toEqual({ puntoVenta: 501, numero: 317611 });
  });

  it("no acepta texto alrededor: para eso está la referencia", () => {
    expect(numeroDelVoucher("FC A 0006-00010192")).toBeNull();
    expect(numeroDelVoucher("")).toBeNull();
    expect(numeroDelVoucher(null)).toBeNull();
  });
});

const FACTURA: FacturaParaConciliar = {
  id: "f1",
  cuit_emisor: "20165811640",
  tipo_comprobante: 1,
  punto_venta: 6,
  numero: 10192,
  importe_total: 1774706.1,
  empresaOdoo: 1,
};

function movimiento(parcial: Partial<MovimientoDeOdoo>): MovimientoDeOdoo {
  return {
    id: 900,
    voucherName: "0006-00010192",
    voucherCodigo: 1,
    ref: null,
    cuitDelPartner: "20165811640",
    empresaOdoo: 1,
    estado: "posted",
    fecha: "2026-09-10",
    importeTotal: 1774706.1,
    nombre: "BILL/2026/09/0004",
    ...parcial,
  };
}

describe("reconocer en Odoo la factura del buzón", () => {
  it("la encuentra por el número del comprobante y el CUIT del emisor", () => {
    const { vinculos } = conciliar([FACTURA], [movimiento({})]);
    expect(vinculos).toEqual([
      {
        facturaId: "f1",
        odooMoveId: 900,
        odooNombre: "BILL/2026/09/0004",
        odooEstado: "posted",
        por: "numero",
        aviso: null,
      },
    ]);
  });

  it("el CUIT se compara normalizado: el padrón lo escribe con guiones", () => {
    const { vinculos } = conciliar([FACTURA], [movimiento({ cuitDelPartner: "20-16581164-0" })]);
    expect(vinculos).toHaveLength(1);
  });

  it("no la enlaza si el número coincide pero el proveedor no", () => {
    const { vinculos } = conciliar([FACTURA], [movimiento({ cuitDelPartner: "30641068019" })]);
    expect(vinculos).toEqual([]);
  });

  it("no la enlaza a un asiento de la otra empresa", () => {
    // Sería un enlace correcto en apariencia y una contabilidad equivocada.
    const { vinculos } = conciliar([FACTURA], [movimiento({ empresaOdoo: 2 })]);
    expect(vinculos).toEqual([]);
  });

  it("no la enlaza sólo porque el importe coincida", () => {
    const { vinculos } = conciliar(
      [FACTURA],
      [movimiento({ voucherName: null, ref: "REMITOS MEMBRANEX" })]
    );
    expect(vinculos).toEqual([]);
  });

  /*
   * Una nota de crédito lleva la referencia de la factura que revierte, y hasta
   * puede llevar su mismo número. Son documentos distintos: el tipo los separa.
   */
  it("no confunde una nota de crédito con la factura que revierte", () => {
    const { vinculos } = conciliar([FACTURA], [movimiento({ voucherCodigo: 3 })]);
    expect(vinculos).toEqual([]);
  });

  it("ignora las facturas del buzón que no tienen número", () => {
    const sinNumero: FacturaParaConciliar = { ...FACTURA, punto_venta: null, numero: null };
    const { vinculos } = conciliar([sinNumero], [movimiento({})]);
    expect(vinculos).toEqual([]);
  });

  it("acepta el enlace cuando la factura del buzón todavía no tiene empresa", () => {
    const { vinculos } = conciliar([{ ...FACTURA, empresaOdoo: null }], [movimiento({})]);
    expect(vinculos).toHaveLength(1);
  });

  it("avisa cuando el importe de Odoo no coincide con el del comprobante", () => {
    const { vinculos } = conciliar([FACTURA], [movimiento({ importeTotal: 1774000 })]);
    expect(vinculos[0].aviso).toContain("1774000");
  });

  it("con dos candidatos no elige: la deja sin vincular y lo informa", () => {
    const { vinculos, ambiguas } = conciliar(
      [FACTURA],
      [movimiento({ id: 900 }), movimiento({ id: 901 })]
    );
    expect(vinculos).toEqual([]);
    expect(ambiguas).toEqual([{ facturaId: "f1", candidatos: [900, 901] }]);
  });
});

describe("la referencia de texto libre, que es el respaldo", () => {
  /*
   * Son las 11 facturas de 6.423 que no tienen `voucher_name`. El resto de las
   * reglas de acá existen porque ese campo es texto libre donde administración
   * escribe notas, y no se puede confiar en él como en el campo propio.
   */
  const sinVoucher = (parcial: Partial<MovimientoDeOdoo> = {}) =>
    movimiento({ voucherName: null, voucherCodigo: null, ...parcial });

  it("reconoce el número escrito en la referencia, y lo dice", () => {
    const { vinculos } = conciliar([FACTURA], [sinVoucher({ ref: "FC A 00006-00010192" })]);
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0].por).toBe("referencia");
  });

  it("un asiento con el campo propio le gana a uno que sólo lo tiene en la referencia", () => {
    // Es lo que resuelve el caso RUBIALES: el mismo número escrito a mano en
    // seis asientos distintos no vuelve ambigua a la factura que sí lo tiene.
    const { vinculos, ambiguas } = conciliar(
      [FACTURA],
      [
        movimiento({ id: 900 }),
        sinVoucher({ id: 901, ref: "FC A 00006-00010192" }),
        sinVoucher({ id: 902, ref: "FC A 00006-00010192 - FC A 00006-00010193" }),
      ]
    );
    expect(ambiguas).toEqual([]);
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0].odooMoveId).toBe(900);
  });

  it("un asiento que agrupa varios comprobantes vincula a todos", () => {
    const otra: FacturaParaConciliar = { ...FACTURA, id: "f2", numero: 10193 };
    const { vinculos } = conciliar(
      [FACTURA, otra],
      [
        sinVoucher({
          ref: "FC A 00006-00010192 - FC A 00006-00010193",
          importeTotal: 3000000,
        }),
      ]
    );
    expect(vinculos.map((v) => v.facturaId)).toEqual(["f1", "f2"]);
  });

  it("no compara el importe cuando el asiento agrupa varios comprobantes", () => {
    const { vinculos } = conciliar(
      [FACTURA],
      [
        sinVoucher({
          ref: "FC A 00006-00010192 - FC A 00006-00010193",
          importeTotal: 3000000,
        }),
      ]
    );
    expect(vinculos[0].aviso).toBeNull();
  });
});

describe("qué estado del buzón corresponde al de Odoo", () => {
  it("posteada es contabilizada, que es lo único que cierra el círculo", () => {
    expect(estadoSegunOdoo("posted")).toBe("contabilizada");
  });

  it("un borrador dice que llegó, no que se contabilizó", () => {
    expect(estadoSegunOdoo("draft")).toBe("informada");
  });

  it("cualquier otra cosa no mueve el estado", () => {
    expect(estadoSegunOdoo("cancel")).toBeNull();
  });
});
