import { describe, it, expect } from "vitest";
import {
  buscarLineas,
  interpretarFila,
  numerosDeLaFila,
  sinRepetir,
} from "./lineasDelPdf";

/*
 * Las filas de acá son **textuales** del PDF de ALMENTA JUAN CARLOS, factura
 * A 0006-00010192, la primera que se cargó al buzón: salieron de correr
 * `getTextContent()` de pdf.js sobre el archivo que está en el bucket. Con sus
 * repeticiones, sus números adentro de la descripción y su pie que imita una
 * línea de detalle. Inventarlas prolijas habría probado un problema que no
 * existe.
 */
const FACTURA_ALMENTA = [
  "FACTURA Nº: 0006-00010192",
  "A A",
  "Fecha: 10/9/2026",
  "Cod.01 Cod.01 Fecha: 10/9/2026",
  "RESPONSABLE INSCRIPTO",
  "Necochea 2918 - OLAVARRIA Cp 7400 C.U.I.T.: 20-16581164-0 Necochea 2918 - OLAVARRIA Cp 7400",
  "C.U.I.T.: 20-16581164-0",
  "02284 420765 Ingresos Brutos: 20-16581164-0 02284 420765",
  "Inicio Actividades: 01/11/2004",
  "Sr./es: POLCECAL S.A. ( 1073 ) Sr./es: POLCECAL S.A. ( 1073 )",
  "Domicilio: OLAVARRIA SIERRAS BAYAS Domicilio: OLAVARRIA SIERRAS BAYAS",
  "I Responsable Inscripto C.U.I.T.: 30-64106801-9 C.U.I.T.: 30-64106801-9",
  "Cond. de Venta: Vto.: 10/09/2026 Cond. de Venta: Vto.: 10/09/2026",
  "PRODUCTO CANT. P / U TOTAL PRODUCTO CANT. P / U TOTAL",
  "CPO BOMBA MOTORARG 428X4/7.5 1,00 528.428,93 528.428,93 CPO BOMBA MOTORARG 428X4/7.5 1,00 528.428,93 528.428,93",
  "MOTOR SUM. MOTORARG S4-XS AE 7.5 HP T 1,00 792.303,31 792.303,31 MOTOR SUM. MOTORARG S4-XS AE 7.5 HP T 1,00 792.303,31 792.303,31",
  "CONDUCTOR CHATO 3x2.5mm 20,00 4.426,45 88.528,93 CONDUCTOR CHATO 3x2.5mm 20,00 4.426,45 88.528,93",
  "EMPALME ELECTRICO 1,00 57.438,02 57.438,02 EMPALME ELECTRICO 1,00 57.438,02 57.438,02",
  "Subtotal 1466699,26 1466699,26",
  "Recargo 0,00 Recargo 0,00",
  "Bonificación 0,00 0,00",
  "I.V.A. 10,5% 0,00 0,00",
  "C.A.E.: 86372444134504 86372444134504",
  "I.V.A. 21% 308006,84 I.V.A. 21% 308006,84",
  "Fecha Vto.: 20/09/2026 TOTAL $ 1.774.706,10",
];

/** El neto del comprobante: 1.774.706,10 / 1,21. */
const NETO = 1466699.26;

describe("los números de una fila", () => {
  it("lee el formato argentino con separador de miles", () => {
    expect(numerosDeLaFila("1,00 528.428,93 528.428,93")).toEqual([1, 528428.93, 528428.93]);
  });

  it("lee también los que vienen sin separador de miles", () => {
    expect(numerosDeLaFila("Subtotal 1466699,26")).toEqual([1466699.26]);
  });

  it("no se pierde los que están metidos en la descripción", () => {
    expect(numerosDeLaFila("CONDUCTOR CHATO 3x2.5mm 20,00")).toEqual([3, 2.5, 20]);
  });
});

describe("la repetición que dibujan algunos PDF", () => {
  it("deja una sola copia cuando la fila está exactamente duplicada", () => {
    expect(sinRepetir("EMPALME ELECTRICO 1,00 57.438,02 57.438,02 EMPALME ELECTRICO 1,00 57.438,02 57.438,02")).toBe(
      "EMPALME ELECTRICO 1,00 57.438,02 57.438,02"
    );
  });

  it("no toca una fila que no está duplicada", () => {
    expect(sinRepetir("Bonificación 0,00 0,00")).toBe("Bonificación 0,00 0,00");
  });

  it("no confunde con una duplicación algo que apenas se parece", () => {
    expect(sinRepetir("PRODUCTO CANT. P / U TOTAL")).toBe("PRODUCTO CANT. P / U TOTAL");
  });
});

describe("interpretar una fila como línea de detalle", () => {
  it("la reconoce cuando cantidad por precio da el total", () => {
    expect(interpretarFila("EMPALME ELECTRICO 1,00 57.438,02 57.438,02")).toEqual({
      descripcion: "EMPALME ELECTRICO",
      cantidad: 1,
      precioUnitario: 57438.02,
      total: 57438.02,
    });
  });

  /*
   * La que obligó a que la tolerancia fuera relativa: 20 × 4.426,45 = 88.529,00
   * y el papel dice 88.528,93. Siete centavos.
   */
  it("aguanta que el papel redondee la multiplicación", () => {
    const linea = interpretarFila("CONDUCTOR CHATO 3x2.5mm 20,00 4.426,45 88.528,93");
    expect(linea?.total).toBe(88528.93);
    expect(linea?.cantidad).toBe(20);
  });

  it("no se come los números de la descripción como si fueran columnas", () => {
    expect(interpretarFila("CPO BOMBA MOTORARG 428X4/7.5 1,00 528.428,93 528.428,93")).toEqual({
      descripcion: "CPO BOMBA MOTORARG 428X4/7.5",
      cantidad: 1,
      precioUnitario: 528428.93,
      total: 528428.93,
    });
  });

  it("rechaza el pie del comprobante aunque la cuenta cierre", () => {
    // 10,5 × 0 = 0. Cierra, y no es un producto.
    expect(interpretarFila("I.V.A. 10,5% 0,00 0,00")).toBeNull();
    expect(interpretarFila("Subtotal 1466699,26")).toBeNull();
    expect(interpretarFila("Bonificación 0,00 0,00")).toBeNull();
  });

  it("rechaza las filas de datos que no son detalle", () => {
    for (const fila of [
      "Fecha: 10/9/2026",
      "C.U.I.T.: 20-16581164-0",
      "Inicio Actividades: 01/11/2004",
      "PRODUCTO CANT. P / U TOTAL",
      "Sr./es: POLCECAL S.A. ( 1073 )",
      "02284 420765 Ingresos Brutos: 20-16581164-0",
    ]) {
      expect(interpretarFila(fila), fila).toBeNull();
    }
  });

  it("no acepta una línea sin descripción", () => {
    expect(interpretarFila("1,00 57.438,02 57.438,02")).toBeNull();
  });
});

describe("el detalle completo de una factura real", () => {
  it("saca las cuatro líneas de la factura de ALMENTA y ninguna de más", () => {
    const { lineas, sumado, cuadra, motivo } = buscarLineas(FACTURA_ALMENTA, {
      netoEsperado: NETO,
    });

    expect(lineas.map((l) => l.descripcion)).toEqual([
      "CPO BOMBA MOTORARG 428X4/7.5",
      "MOTOR SUM. MOTORARG S4-XS AE 7.5 HP T",
      "CONDUCTOR CHATO 3x2.5mm",
      "EMPALME ELECTRICO",
    ]);
    // 1.466.699,19 contra un neto de 1.466.699,26: los siete centavos del
    // redondeo de la tercera línea.
    expect(sumado).toBe(1466699.19);
    expect(cuadra).toBe(true);
    expect(motivo).toBeNull();
  });

  it("si falta una línea, la suma no cuadra y el detalle no se usa", () => {
    const sinUna = FACTURA_ALMENTA.filter((f) => !f.startsWith("EMPALME"));
    const { cuadra, motivo } = buscarLineas(sinUna, { netoEsperado: NETO });
    expect(cuadra).toBe(false);
    expect(motivo).toContain("no se usan");
  });

  it("si se colara una línea de más, tampoco se usa", () => {
    const conRuido = [...FACTURA_ALMENTA, "FLETE 1,00 10.000,00 10.000,00"];
    expect(buscarLineas(conRuido, { netoEsperado: NETO }).cuadra).toBe(false);
  });

  it("sin neto esperado devuelve las líneas pero no las da por buenas", () => {
    const { lineas, cuadra, motivo } = buscarLineas(FACTURA_ALMENTA, {});
    expect(lineas).toHaveLength(4);
    expect(cuadra).toBe(false);
    expect(motivo).toContain("no hay contra qué controlar");
  });

  it("un comprobante sin detalle legible lo dice, y no inventa", () => {
    const { lineas, cuadra, motivo } = buscarLineas(["Subtotal 1000,00", "TOTAL $ 1.210,00"], {
      netoEsperado: 1000,
    });
    expect(lineas).toEqual([]);
    expect(cuadra).toBe(false);
    expect(motivo).toContain("ninguna línea");
  });
});
