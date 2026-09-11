import { describe, it, expect } from "vitest";
import {
  LUGARES_DE_DESCARGA,
  TONELADAS_VISTAS,
  netoDeLaRecepcion,
  estadoDeLaRecepcion,
  proximoPaso,
  celdasDeLaRecepcion,
  primerasCeldas,
  fechaComoSeEscribe,
  cantidadComoSeEscribe,
  ordenComoSeEscribe,
  COLUMNA_QUE_NO_SE_TOCA,
} from "./recepcion";
import type { Recepcion } from "./types";

const base: Recepcion = {
  id: "r1",
  fecha: "2026-09-11",
  empresa_id: "e1",
  proveedor_id: "p1",
  odoo_product_id: 4321,
  odoo_product_nombre: "CARBONILLA",
  peso_bruto_kg: null,
  peso_tara_kg: null,
  lugar_descarga: null,
  notas: null,
  odoo_purchase_order_id: null,
  odoo_purchase_name: null,
  odoo_picking_id: null,
  odoo_error: null,
  odoo_error_en: null,
  sheets_fila: null,
  sheets_pendiente: null,
  sheets_pendiente_en: null,
  cargado_por: "u1",
  cargado_en: "2026-09-11T10:00:00Z",
  actualizado_por: null,
  actualizado_en: null,
};

describe("netoDeLaRecepcion", () => {
  it("el neto es bruto menos tara, en kilos y en toneladas con dos decimales", () => {
    const n = netoDeLaRecepcion({ peso_bruto_kg: 32_400, peso_tara_kg: 12_610 });
    expect(n.kg).toBe(19_790);
    expect(n.toneladas).toBe(19.79); // el promedio del año, justamente
    expect(n.problema).toBeNull();
    expect(n.aviso).toBeNull();
  });

  it("sin los dos pesos todavía no hay neto, y eso no es un problema", () => {
    expect(netoDeLaRecepcion({ peso_bruto_kg: 32_400, peso_tara_kg: null })).toEqual({
      kg: null, toneladas: null, problema: null, aviso: null,
    });
    expect(netoDeLaRecepcion({ peso_bruto_kg: null, peso_tara_kg: null }).problema).toBeNull();
  });

  /**
   * El caso que importa de verdad. De acá sale la cantidad de una orden de
   * compra que se confirma sola: un neto negativo entraría a la contabilidad del
   * grupo sin que nadie lo mire. Tiene que verse, no calcularse.
   */
  it("la tara mayor que el bruto es un error de tipeo, no un neto negativo", () => {
    const n = netoDeLaRecepcion({ peso_bruto_kg: 12_610, peso_tara_kg: 32_400 });
    expect(n.kg).toBeNull();
    expect(n.toneladas).toBeNull();
    expect(n.problema).toContain("mayor que el bruto");
  });

  it("bruto igual a tara tampoco es una recepción: el neto daría cero", () => {
    const n = netoDeLaRecepcion({ peso_bruto_kg: 20_000, peso_tara_kg: 20_000 });
    expect(n.kg).toBeNull();
    expect(n.problema).toContain("cero");
  });

  /**
   * Fuera del rango de todo un año (4,1 a 44,36 t) avisa pero devuelve el
   * número: el papel es el papel y un camión puede traer algo raro. Lo que no
   * puede es entrar un cero de más sin que nadie lo vea.
   */
  it("fuera de lo visto en un año avisa, pero no bloquea", () => {
    const cero = netoDeLaRecepcion({ peso_bruto_kg: 12_500, peso_tara_kg: 12_000 });
    expect(cero.toneladas).toBe(0.5);
    expect(cero.problema).toBeNull();
    expect(cero.aviso).toContain("fuera de lo que trajo un camión");

    const demas = netoDeLaRecepcion({ peso_bruto_kg: 332_400, peso_tara_kg: 12_610 });
    expect(demas.toneladas).toBe(319.79);
    expect(demas.aviso).toContain("319.79");

    // Y en el borde exacto de lo medido, no avisa.
    expect(netoDeLaRecepcion({ peso_bruto_kg: 14_460, peso_tara_kg: 10_360 }).toneladas)
      .toBe(TONELADAS_VISTAS.minimo);
    expect(netoDeLaRecepcion({ peso_bruto_kg: 14_460, peso_tara_kg: 10_360 }).aviso).toBeNull();
  });
});

describe("estadoDeLaRecepcion y el próximo paso", () => {
  it("recorre los tres pasos y termina cerrada", () => {
    expect(estadoDeLaRecepcion(base)).toBe("esperando_bruto");
    const conBruto = { ...base, peso_bruto_kg: 32_400 };
    expect(estadoDeLaRecepcion(conBruto)).toBe("descargando");
    const conTara = { ...conBruto, peso_tara_kg: 12_610 };
    expect(estadoDeLaRecepcion(conTara)).toBe("lista");
    expect(estadoDeLaRecepcion({ ...conTara, odoo_purchase_order_id: 9001 })).toBe("cerrada");
  });

  /**
   * La orden manda sobre los pesos: una recepción con orden está cerrada aunque
   * después alguien le borre un peso. Si no, la pantalla volvería a ofrecer
   * "cerrar" sobre algo que ya tiene su orden en Odoo, y ése es el error caro.
   */
  it("con orden ya creada está cerrada, aunque le falte un peso", () => {
    expect(estadoDeLaRecepcion({ ...base, odoo_purchase_order_id: 9001 })).toBe("cerrada");
    expect(proximoPaso({ ...base, odoo_purchase_order_id: 9001 })).toBeNull();
  });

  it("el próximo paso es uno solo, y es el estado en el que está", () => {
    expect(proximoPaso(base)).toBe("esperando_bruto");
    expect(proximoPaso({ ...base, peso_bruto_kg: 32_400 })).toBe("descargando");
  });
});

describe("las celdas de la planilla", () => {
  const celdas = celdasDeLaRecepcion({
    fecha: "2026-09-11",
    proveedor: "Bruzzone",
    toneladas: 19.79,
    notas: "Carbon de Coke",
    odooNombre: "P01615",
    lugarDescarga: "ARRIBA",
  });

  /**
   * La `E` (`Total del Dia `) no aparece nunca. Está vacía en los 567 renglones
   * y el total vive como fórmula en la otra pestaña: escribir ahí es lo que
   * convierte una fórmula en dato muerto.
   */
  it("nunca incluye la columna del total del día", () => {
    expect(celdas.map((c) => c.columna)).toEqual([0, 1, 2, 3, 5, 6]);
    expect(celdas.some((c) => c.columna === COLUMNA_QUE_NO_SE_TOCA)).toBe(false);
  });

  it("escribe cada cosa como la escribe el libro", () => {
    expect(celdas.find((c) => c.columna === 0)?.valor).toBe("11/9/2026");
    expect(celdas.find((c) => c.columna === 1)?.valor).toBe("Bruzzone");
    expect(celdas.find((c) => c.columna === 2)?.valor).toBe("19,79");
    expect(celdas.find((c) => c.columna === 5)?.valor).toBe("orden 1615");
    expect(celdas.find((c) => c.columna === 6)?.valor).toBe("ARRIBA");
  });

  it("lo que falta va vacío y no inventado", () => {
    const sinNada = celdasDeLaRecepcion({
      fecha: "2026-09-11", proveedor: "Sosa", toneladas: null,
      notas: null, odooNombre: null, lugarDescarga: null,
    });
    expect(sinNada.map((c) => c.valor)).toEqual(["11/9/2026", "Sosa", "", "", "", ""]);
  });

  it("las primeras cuatro son las que se agregan, y dejan la E intacta", () => {
    expect(primerasCeldas(celdas)).toEqual(["11/9/2026", "Bruzzone", "19,79", "Carbon de Coke"]);
    expect(primerasCeldas(celdas)).toHaveLength(4);
  });
});

describe("cómo se escribe cada cosa", () => {
  /** d/m y nunca m/d: leerlo al revés dio vuelta 885 fechas en Compras. */
  it("la fecha va en d/m", () => {
    expect(fechaComoSeEscribe("2026-09-11")).toBe("11/9/2026");
    expect(fechaComoSeEscribe("2026-12-01")).toBe("1/12/2026");
    expect(fechaComoSeEscribe("no es una fecha")).toBe("");
  });

  it("la cantidad va con coma decimal y dos decimales, como el libro", () => {
    expect(cantidadComoSeEscribe(19.79)).toBe("19,79");
    expect(cantidadComoSeEscribe(20)).toBe("20,00");
    expect(cantidadComoSeEscribe(4.1)).toBe("4,10");
  });

  /** `orden 1615` **es** la `P01615`: se comprobó contra las dos bases. */
  it("el Nº de orden va como lo escribe el libro, no como lo escribe Odoo", () => {
    expect(ordenComoSeEscribe("P01615")).toBe("orden 1615");
    expect(ordenComoSeEscribe("P02421")).toBe("orden 2421");
    expect(ordenComoSeEscribe(null)).toBe("");
    // Si algún día Odoo cambia la forma del nombre, se escribe tal cual: de
    // `OC/2026/0015` saldría "orden 2026", que es inventar el número que
    // alguien va a anotar en el papel del carbonillero.
    expect(ordenComoSeEscribe("OC/2026/0015")).toBe("OC/2026/0015");
  });
});

describe("los lugares de descarga", () => {
  it("son los dos que dice el libro", () => {
    expect(LUGARES_DE_DESCARGA).toEqual(["ARRIBA", "ABAJO"]);
  });
});
