import { describe, it, expect } from "vitest";
import {
  TIPOS_DE_COMPROBANTE,
  claveNatural,
  discriminaIva,
  esNotaDeCredito,
  letraDelComprobante,
  nombreDelComprobante,
  nombreDelTipo,
  numeroFormateado,
  referenciaParaOdoo,
} from "./comprobante";

describe("cómo se nombra un comprobante", () => {
  it("traduce los códigos que el grupo recibe", () => {
    expect(nombreDelTipo(1)).toBe("Factura A");
    expect(nombreDelTipo(6)).toBe("Factura B");
    expect(nombreDelTipo(11)).toBe("Factura C");
    expect(nombreDelTipo(3)).toBe("Nota de crédito A");
    expect(nombreDelTipo(201)).toBe("Factura de crédito A");
  });

  /*
   * Un código desconocido tiene que decir el número. Es la diferencia entre
   * poder buscarlo en la tabla de AFIP y quedarse sin saber qué llegó.
   */
  it("un código que no está en la tabla dice el número", () => {
    expect(nombreDelTipo(88)).toBe("Comprobante tipo 88");
    expect(nombreDelTipo(null)).toBe("Comprobante");
  });

  it("el número se escribe como sale impreso", () => {
    // El archivo que llegó por mail se llama "…-Factura A-0005-00003733".
    expect(numeroFormateado(5, 3733)).toBe("0005-00003733");
  });

  it("un comprobante sin datos no inventa un número", () => {
    expect(numeroFormateado(null, null)).toBe("????-????????");
  });

  it("el nombre completo junta las dos cosas", () => {
    expect(nombreDelComprobante({ tipoComprobante: 1, puntoVenta: 5, numero: 3733 })).toBe(
      "Factura A 0005-00003733"
    );
  });
});

describe("las notas de crédito restan", () => {
  it("reconoce las de las tres letras y las de FCE", () => {
    for (const tipo of [3, 8, 13, 21, 53, 203, 208, 213]) {
      expect(esNotaDeCredito(tipo), String(tipo)).toBe(true);
    }
  });

  it("una factura o una nota de débito no restan", () => {
    for (const tipo of [1, 6, 11, 2, 7, 12, 201, 206]) {
      expect(esNotaDeCredito(tipo), String(tipo)).toBe(false);
    }
  });

  it("sin tipo no se supone nada", () => {
    expect(esNotaDeCredito(null)).toBe(false);
  });
});

describe("la clave natural del comprobante", () => {
  const completa = { cuitEmisor: "23214811839", tipoComprobante: 1, puntoVenta: 5, numero: 3733 };

  it("son los cuatro datos fiscales", () => {
    expect(claveNatural(completa)).toEqual({
      cuit_emisor: "23214811839",
      tipo_comprobante: 1,
      punto_venta: 5,
      numero: 3733,
    });
  });

  /*
   * El test que importa: **falta uno, no hay clave.** Completar con ceros haría
   * que dos comprobantes distintos choquen en el índice único, y el segundo se
   * perdería sin que nada avise. Sin clave la factura entra igual; lo único que
   * se pierde es la detección de duplicados, que es lo que corresponde.
   */
  it("si falta un dato no hay clave, y no se completa con ceros", () => {
    expect(claveNatural({ ...completa, numero: null })).toBeNull();
    expect(claveNatural({ ...completa, puntoVenta: null })).toBeNull();
    expect(claveNatural({ ...completa, tipoComprobante: null })).toBeNull();
    expect(claveNatural({ ...completa, cuitEmisor: null })).toBeNull();
  });

  it("un CUIT que no tiene once dígitos no sirve como clave", () => {
    expect(claveNatural({ ...completa, cuitEmisor: "2321481183" })).toBeNull();
    expect(claveNatural({ ...completa, cuitEmisor: "23-21481183-9" })).toBeNull();
  });
});

describe("la letra del comprobante", () => {
  it("sale del código de ARCA", () => {
    expect(letraDelComprobante(1)).toBe("A");
    expect(letraDelComprobante(6)).toBe("B");
    expect(letraDelComprobante(11)).toBe("C");
    expect(letraDelComprobante(51)).toBe("M");
    expect(letraDelComprobante(201)).toBe("A");
  });

  it("un código que no está en la tabla no tiene letra", () => {
    expect(letraDelComprobante(88)).toBeNull();
    expect(letraDelComprobante(null)).toBeNull();
  });

  it("todo comprobante con nombre tiene letra: las dos tablas no se separan", () => {
    for (const codigo of Object.keys(TIPOS_DE_COMPROBANTE).map(Number)) {
      expect(letraDelComprobante(codigo), String(codigo)).not.toBeNull();
    }
  });
});

describe("si el comprobante discrimina IVA", () => {
  it("las A, las B y las M sí; las C no", () => {
    // Medido contra el grupo: 793 facturas A, todas con impuesto; 4 C, ninguna.
    expect(discriminaIva(1)).toBe(true);
    expect(discriminaIva(6)).toBe(true);
    expect(discriminaIva(51)).toBe(true);
    expect(discriminaIva(11)).toBe(false);
  });

  it("ante un tipo desconocido no inventa un crédito fiscal", () => {
    expect(discriminaIva(88)).toBe(false);
    expect(discriminaIva(null)).toBe(false);
  });
});

describe("la referencia con la que la factura se escribe en Odoo", () => {
  it("usa la sigla que ya escribe administración y el punto de venta en cinco dígitos", () => {
    expect(referenciaParaOdoo({ tipoComprobante: 1, puntoVenta: 6, numero: 10192 })).toBe(
      "FC A 00006-00010192"
    );
    expect(referenciaParaOdoo({ tipoComprobante: 3, puntoVenta: 8, numero: 3715 })).toBe(
      "NC A 00008-00003715"
    );
    expect(referenciaParaOdoo({ tipoComprobante: 201, puntoVenta: 8, numero: 273 })).toBe(
      "FCE A 00008-00000273"
    );
  });

  it("un tipo desconocido deja el número solo, sin inventarle sigla", () => {
    expect(referenciaParaOdoo({ tipoComprobante: 88, puntoVenta: 6, numero: 10192 })).toBe(
      "00006-00010192"
    );
  });

  it("sin número no hay referencia", () => {
    expect(referenciaParaOdoo({ tipoComprobante: 1, puntoVenta: null, numero: 10192 })).toBeNull();
  });
});
