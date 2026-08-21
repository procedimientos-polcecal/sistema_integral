import { describe, it, expect } from "vitest";
import {
  COLUMNAS_COMPARATIVA, mapearEncabezados, filasParaEsteRi,
  totalCotizacion, parsearFila, filaParaPlanilla, DISPONIBILIDADES, PLAZOS_PAGO,
} from "./comparativa";

const ENCABEZADO = [...COLUMNAS_COMPARATIVA];

describe("total de una cotización", () => {
  it("suma el envío, que la fórmula de la planilla dejaba afuera", () => {
    // 100 × 2 = 200, sin descuento, +21% = 242, + 50 de envío = 292
    expect(totalCotizacion({
      precio_unitario: 100, cantidad: 2, descuento: 0, iva: 0.21, costo_envio: 50,
    })).toBe(292);
  });

  it("aplica el descuento antes del IVA", () => {
    // 100 × 1 × 0.9 = 90, +21% = 108.9
    expect(totalCotizacion({
      precio_unitario: 100, cantidad: 1, descuento: 0.1, iva: 0.21, costo_envio: null,
    })).toBe(108.9);
  });

  it("una cantidad vacía vale 1: es una cotización por monto total", () => {
    expect(totalCotizacion({
      precio_unitario: 1000, cantidad: null, descuento: null, iva: 0, costo_envio: null,
    })).toBe(1000);
  });

  it("redondea a dos decimales", () => {
    // 33.33 × 3 = 99.99, +21% = 120.9879
    expect(totalCotizacion({
      precio_unitario: 33.33, cantidad: 3, descuento: 0, iva: 0.21, costo_envio: null,
    })).toBe(120.99);
  });
});

describe("mapeo de encabezados", () => {
  it("encuentra las columnas de la plantilla genérica", () => {
    const r = mapearEncabezados(ENCABEZADO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idx.nro_ri).toBe(0);
    expect(r.idx.proveedor).toBe(4);
    expect(r.idx.precio_unitario).toBe(7);
    expect(r.idx.eleccion).toBe(18);
  });

  it("tolera acentos, mayúsculas y espacios de más", () => {
    const raro = ENCABEZADO.map((c) => `  ${c.toLowerCase()}  `);
    expect(mapearEncabezados(raro).ok).toBe(true);
  });

  it("rechaza una planilla con otra estructura y dice qué falta", () => {
    const r = mapearEncabezados(["FECHA", "COSA", "OTRA COSA"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltan).toContain("PROVEEDOR");
    expect(r.faltan).toContain("PRECIO UNITARIO");
  });
});

describe("regla de la columna A", () => {
  const filas = [
    ["", "", "", "", "Proveedor Vacio", "", "", "100"],       // fila 2: libre
    ["1850", "", "", "", "Proveedor Propio", "", "", "200"],  // fila 3: de este RI
    ["999", "", "", "", "Proveedor Ajeno", "", "", "300"],    // fila 4: de otro RI
    ["", "", "", "", "", "", "", ""],                         // fila 5: vacía
  ];

  it("trae las filas vacías y las de este RI, e ignora las de otro", () => {
    const r = filasParaEsteRi(filas, 0, 1850);
    expect(r.propias.map((p) => p.numeroFila)).toEqual([2, 3]);
    expect(r.ajenas).toBe(1);
  });

  it("no cuenta las filas vacías como ajenas ni como propias", () => {
    const r = filasParaEsteRi(filas, 0, 1850);
    expect(r.propias).toHaveLength(2);
    expect(r.ajenas).toBe(1);
  });
});

describe("parsear una fila de la planilla", () => {
  it("lee los porcentajes como fracción y las fechas como ISO", () => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");
    const fila = [
      "1850", "1/8/2026", "Mantenimiento", "Filtro de aceite", "Repuestos SA",
      "XCMG", "unidad", "1500,50", "4", "800", "10%", "21%", "", "31/8/2026",
      "30", "Transferencia 30 días", "4-7 días", "Sin stock del original", "",
    ];
    const c = parsearFila(fila, r.idx);
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.proveedor_nombre).toBe("Repuestos SA");
    expect(c.marca).toBe("XCMG");
    expect(c.precio_unitario).toBe(1500.5);
    expect(c.cantidad).toBe(4);
    expect(c.costo_envio).toBe(800);
    expect(c.descuento).toBe(0.1);
    expect(c.iva).toBe(0.21);
    expect(c.precio_hasta).toBe("2026-08-31");
    expect(c.plazo_pago_dias).toBe(30);
    expect(c.disponibilidad).toBe("4-7 días");
  });

  it("una fila sin proveedor ni precio no es un presupuesto", () => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");
    expect(parsearFila(["1850", "", "", "", "", ""], r.idx)).toBeNull();
  });
});

describe("fila para escribir en la planilla", () => {
  it("pone el N° de RI en la columna A y la fórmula del total con el envío", () => {
    const r = mapearEncabezados(ENCABEZADO);
    if (!r.ok) throw new Error("encabezado inválido");

    const fila = filaParaPlanilla({
      idx: r.idx,
      numeroFila: 7,
      nroRi: 1850,
      fecha: "2026-08-21",
      area: "Mantenimiento",
      descripcion: "Filtro de aceite",
      cotizacion: {
        proveedor_nombre: "Repuestos SA", marca: "XCMG", unidad_medida: "unidad",
        precio_unitario: 1500.5, cantidad: 4, costo_envio: 800,
        descuento: 0.1, iva: 0.21, precio_hasta: "2026-08-31",
        plazo_pago_dias: 30, condiciones_pago: "Transferencia",
        disponibilidad: "4-7 días", comentario: "",
      },
    });

    expect(fila).toHaveLength(19);
    expect(fila[0]).toBe("1850");
    expect(fila[4]).toBe("Repuestos SA");
    expect(fila[10]).toBe("10%");
    expect(fila[11]).toBe("21%");
    expect(fila[12]).toBe("=H7*I7*(1-K7)*(1+L7)+J7");
    expect(fila[18]).toBe("FALSE");
  });
});

describe("listas de la planilla", () => {
  it("los plazos de pago son los del desplegable", () => {
    expect(PLAZOS_PAGO).toEqual([0, 15, 21, 30, 45, 60, 90, 120, 150]);
  });

  it("la disponibilidad copia el desplegable tal cual, con su error de tipeo", () => {
    // "1-3 día" está en singular en la planilla. Corregirlo acá haría que la
    // validación de datos de Sheets rechace el valor al escribirlo.
    expect(DISPONIBILIDADES[1]).toBe("1-3 día");
  });
});
