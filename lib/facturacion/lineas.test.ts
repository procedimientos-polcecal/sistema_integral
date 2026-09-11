import { describe, it, expect } from "vitest";
import {
  describirDistribucion,
  prepararLineas,
  repartirEnPartesIguales,
  revisarDistribucion,
} from "./lineas";
import { normalizarDescripcion } from "@/lib/compras/productoOdoo";

const CATALOGO = [
  { id: 6909, nombre: "CARBONILLA" },
  { id: 7001, nombre: "CONDUCTOR" },
  { id: 7002, nombre: "MOTOR" },
  { id: 7003, nombre: "BOMBA" },
];

const LINEAS = [
  { descripcion: "CONDUCTOR CHATO 3x2.5mm", cantidad: 20, precioUnitario: 4426.45, total: 88528.93 },
  { descripcion: "EMPALME ELECTRICO", cantidad: 1, precioUnitario: 57438.02, total: 57438.02 },
];

describe("preparar las líneas para guardarlas", () => {
  it("propone el producto con el mismo emparejador que las órdenes de compra", () => {
    const filas = prepararLineas(LINEAS, { catalogo: CATALOGO, aprendidos: new Map() });

    expect(filas[0].odoo_product_nombre).toBe("CONDUCTOR");
    expect(filas[0].producto_origen).toBe("sugerido");
  });

  it("cuando no hay con qué arriesgar, no propone nada", () => {
    // EMPALME no está en el catálogo, y proponer "el que se le parece" es el
    // error que no se nota nunca.
    const filas = prepararLineas(LINEAS, { catalogo: CATALOGO, aprendidos: new Map() });
    expect(filas[1].odoo_product_id).toBeNull();
    expect(filas[1].producto_origen).toBeNull();
  });

  it("lo aprendido gana, y queda dicho que fue aprendido", () => {
    const aprendidos = new Map([[normalizarDescripcion("EMPALME ELECTRICO"), 7002]]);
    const filas = prepararLineas(LINEAS, { catalogo: CATALOGO, aprendidos });

    expect(filas[1].odoo_product_id).toBe(7002);
    expect(filas[1].producto_origen).toBe("aprendido");
  });

  it("respeta el orden en que salen impresas", () => {
    const filas = prepararLineas(LINEAS, { catalogo: CATALOGO, aprendidos: new Map() });
    expect(filas.map((f) => f.orden)).toEqual([0, 1]);
  });

  it("no toca lo que dice el papel", () => {
    const [primera] = prepararLineas(LINEAS, { catalogo: CATALOGO, aprendidos: new Map() });
    expect(primera.descripcion).toBe("CONDUCTOR CHATO 3x2.5mm");
    expect(primera.cantidad).toBe(20);
    expect(primera.total).toBe(88528.93);
  });

  it("la imputación nace vacía: no se adivina a qué equipo fue un repuesto", () => {
    const [primera] = prepararLineas(LINEAS, { catalogo: CATALOGO, aprendidos: new Map() });
    expect(primera.odoo_account_id).toBeNull();
    expect(primera.analitica).toBeNull();
  });
});

describe("la distribución analítica", () => {
  it("vacía es válida: es una línea que nadie imputó todavía", () => {
    expect(revisarDistribucion(null)).toBeNull();
    expect(revisarDistribucion({})).toBeNull();
  });

  it("acepta la que suma 100", () => {
    expect(revisarDistribucion({ "1549": 100 })).toBeNull();
    expect(revisarDistribucion({ "1549": 60, "1550": 40 })).toBeNull();
  });

  /*
   * El caso real del grupo: la carbonilla se reparte entre seis cuentas como
   * 16,67 + 16,66 × 5, que suma **99,97** — y está posteado en Odoo. Exigir 100
   * exacto rechazaría un asiento que Odoo aceptó.
   */
  it("acepta el reparto en seis que usa el grupo, aunque sume 99,97", () => {
    const seis = { "357": 16.67, "391": 16.66, "789": 16.66, "800": 16.66, "811": 16.66, "822": 16.66 };
    expect(revisarDistribucion(seis)).toBeNull();
  });

  it("rechaza la que no suma 100, diciendo cuánto suma", () => {
    expect(revisarDistribucion({ "1549": 80 })).toContain("suman 80");
  });

  it("rechaza un porcentaje que no es positivo", () => {
    expect(revisarDistribucion({ "1549": 100, "1550": 0 })).toContain("1550");
    expect(revisarDistribucion({ "1549": 120, "1550": -20 })).toContain("-20");
  });

  it("rechaza una clave que no es un id de Odoo", () => {
    expect(revisarDistribucion({ MANTENIMIENTO: 100 })).toContain("no es una cuenta analítica");
  });
});

describe("repartir en partes iguales", () => {
  it("dos cuentas van a la mitad", () => {
    expect(repartirEnPartesIguales([1, 2])).toEqual({ "1": 50, "2": 50 });
  });

  it("tres cuentas: el resto se lo queda la primera", () => {
    const r = repartirEnPartesIguales([1, 2, 3]);
    expect(r).toEqual({ "1": 33.34, "2": 33.33, "3": 33.33 });
    expect(revisarDistribucion(r)).toBeNull();
  });

  it("seis cuentas suman 100 exacto, un poco mejor que el reparto de Odoo", () => {
    const r = repartirEnPartesIguales([357, 391, 789, 800, 811, 822]);
    expect(r["357"]).toBe(16.7);
    expect(r["391"]).toBe(16.66);
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });

  it("cualquier cantidad de cuentas termina sumando 100", () => {
    for (let n = 1; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      expect(revisarDistribucion(repartirEnPartesIguales(ids)), `${n} cuentas`).toBeNull();
    }
  });

  it("sin cuentas, no hay distribución", () => {
    expect(repartirEnPartesIguales([])).toEqual({});
  });
});

describe("cómo se lee una distribución", () => {
  it("usa los nombres, que es lo que le dice algo a una persona", () => {
    const nombres = new Map([
      [1549, "ADMINISTRACIÓN (PERSONAL)"],
      [146, "EM1 - CATERPILLAR 320 B"],
    ]);
    expect(describirDistribucion({ "1549": 60, "146": 40 }, nombres)).toBe(
      "ADMINISTRACIÓN (PERSONAL) 60% · EM1 - CATERPILLAR 320 B 40%"
    );
  });

  /*
   * Las claves que parecen enteros las ordena JavaScript de menor a mayor, así
   * que sin ordenar a mano "146" saldría antes que "1549" por más que tenga
   * menos porcentaje.
   */
  it("pone primero la cuenta que se llevó la mayor parte", () => {
    const nombres = new Map([
      [1549, "CHICA"],
      [146, "GRANDE"],
    ]);
    expect(describirDistribucion({ "1549": 30, "146": 70 }, nombres)).toBe("GRANDE 70% · CHICA 30%");
  });

  it("una cuenta que ya no está en el catálogo se muestra por su id", () => {
    expect(describirDistribucion({ "999": 100 }, new Map())).toBe("#999 100%");
  });

  it("sin distribución no hay texto", () => {
    expect(describirDistribucion(null, new Map())).toBeNull();
  });
});
