import { describe, it, expect } from "vitest";
import {
  mapearListado, mapearKardex, filaDeArticulo, filaDeMovimiento,
  grupoDeLaFila, filaDeProveedor, cantidad,
} from "./planilla";

// Los encabezados reales de la planilla, copiados tal cual. "STOCK INICAL" está
// así, sin la segunda "I": el alias tiene que tomarlo igual, porque corregirlo
// allá rompe fórmulas. Y la última columna, "3/9 (0:00)", es una foto que
// alguien pegó a mano: el mapeo por encabezado la ignora sola.
const ENCABEZADO_LISTADO = [
  "Codigo", "Descripción", "STOCK INICAL", "UBICACIÓN",
  "PROVEEDORES (referencia)", "STOCK ACTUAL", "STOCK DE SEGURIDAD", "FALTANTE",
  "3/9 (0:00)",
];

const ENCABEZADO_KARDEX = [
  "CODIGO", "DESCRIPCION", "ENTRADAS", "SALIDAS", "ROTURA", "DESPACHO",
  "STOCK", "FECHA", "OBSERVACIÓN", "PROVEEDOR",
];

describe("el listado", () => {
  it("toma STOCK INICAL, que está mal escrito en la planilla", () => {
    const idx = mapearListado(ENCABEZADO_LISTADO);
    expect(idx.stockInicial).toBe(2);
    expect(idx.stockActual).toBe(5);
    expect(idx.stockSeguridad).toBe(6);
  });

  it("lee un artículo", () => {
    const idx = mapearListado(ENCABEZADO_LISTADO);
    const a = filaDeArticulo(
      ["00001", "BOLSAS CAL GÜEMES", "13600", "", "", "8091", "30000", "21909", "18730"],
      idx, 2
    );
    expect(a).toEqual({
      codigo: "00001",
      descripcion: "BOLSAS CAL GÜEMES",
      ubicacion: null,
      proveedores_ref: null,
      stock_inicial: 13600,
      stock_actual: 8091,
      stock_seguridad: 30000,
      sheets_fila: 2,
    });
  });

  it("descarta la fila sin código o sin descripción", () => {
    const idx = mapearListado(ENCABEZADO_LISTADO);
    expect(filaDeArticulo(["", "", "", "", "", "0"], idx, 40)).toBeNull();
    expect(filaDeArticulo(["00099", "", "", "", "", "0"], idx, 41)).toBeNull();
  });
});

describe("el kardex", () => {
  const idx = mapearKardex(ENCABEZADO_KARDEX);

  it("lee los cuatro números de una fila, y la fecha en d/m", () => {
    const m = filaDeMovimiento(
      ["00001", "BOLSAS CAL GÜEMES", "", "1200", "8", "1200", "12.400", "1/9/2025", "", ""],
      idx, 2
    );
    expect(m).toMatchObject({
      codigo: "00001",
      entrada: 0, salida: 1200, rotura: 8, despacho: 1200,
      // 1 de septiembre, no 9 de enero. Leerlo al revés dio vuelta 885 fechas
      // en Compras.
      fecha: "2025-09-01",
      sheets_fila: 2,
    });
  });

  it("acepta entrada y salida en la misma fila: hay 4 así en la planilla", () => {
    const m = filaDeMovimiento(
      ["00001", "x", "25600", "1500", "", "", "36.500", "2/9/2025"], idx, 10
    );
    expect(m).toMatchObject({ entrada: 25600, salida: 1500 });
  });

  it("acepta despacho con salida en cero: hay 133 así", () => {
    const m = filaDeMovimiento(
      ["00006", "x", "", "0", "", "192", "11.214", "12/9/2026"], idx, 1398
    );
    expect(m).toMatchObject({ salida: 0, despacho: 192 });
  });

  it("descarta la fila sin código y la que no movió nada", () => {
    expect(filaDeMovimiento(["", "x", "", "", "", ""], idx, 1500)).toBeNull();
    expect(filaDeMovimiento(["00001", "x", "", "0", "0", "0"], idx, 1501)).toBeNull();
  });
});

describe("el grupo de envase, que vive en la K sin encabezado", () => {
  it("lo lee de la posición 10", () => {
    const fila = ["00009", "BOLSONES BRALBOL (2,10 CAL)", "", "93", "", "64",
                  "807", "1/9/2025", "", "", "BOLSONES 2,10 + 1,90"];
    expect(grupoDeLaFila(fila)).toBe("BOLSONES 2,10 + 1,90");
  });

  it("no toma un número ni una fecha: eso es una columna corrida", () => {
    // Si alguien inserta una columna, en la posición 10 aparece cualquier cosa.
    // Preferimos null —que se informa— antes que un grupo inventado.
    expect(grupoDeLaFila(["00009", "x", "", "", "", "", "", "", "", "", "807"])).toBeNull();
    expect(grupoDeLaFila(["00009", "x", "", "", "", "", "", "", "", "", "1/9/2025"])).toBeNull();
    expect(grupoDeLaFila(["00009", "x"])).toBeNull();
  });
});

describe("cantidad", () => {
  it("lee el formato argentino: 12.400 son doce mil cuatrocientos", () => {
    expect(cantidad("12.400")).toBe(12400);
    expect(cantidad("1.508")).toBe(1508);
  });

  it("vacío es null y no cero: 'nadie lo contó' no es 'no hay'", () => {
    expect(cantidad("")).toBeNull();
    expect(cantidad("-")).toBeNull();
    expect(cantidad(null)).toBeNull();
    // Un cero escrito sí es cero.
    expect(cantidad("0")).toBe(0);
  });
});

describe("los proveedores", () => {
  const ENCABEZADO = [
    "Proveedor", "Tipo de proveedor", "Nombre", "Contactos",
    "Contacto Alternativo", "Dirección", "Notas", "CUIT",
  ];

  it("lee uno, con su CUIT normalizado", () => {
    const p = filaDeProveedor(
      ["Bralbol", "Bolsones 1.20, Bolsones 2.10", "Belén", "542477270940",
       "administracion@bralbol.com.ar", "Bralbol", "", "30-71515352-8"],
      ENCABEZADO, 8
    );
    expect(p).toMatchObject({
      nombre: "Bralbol",
      tipos: "Bolsones 1.20, Bolsones 2.10",
      contacto_nombre: "Belén",
      contacto_tel: "542477270940",
      cuit: "30715153528",
      sheets_fila: 8,
    });
  });

  it("no confunde la columna del proveedor con la del contacto", () => {
    // Las dos se llaman parecido —"Proveedor" y "Nombre"— y son cosas
    // distintas: el proveedor es Torraco, la persona es Flexi Rigs.
    const p = filaDeProveedor(
      ["Torraco Pablo Javier", "Bolsones 2.10", "Flexi Rigs", "541134912222",
       "pablotorraco@hotmail.com", "", "", "23-21481183-9"],
      ENCABEZADO, 5
    );
    expect(p?.nombre).toBe("Torraco Pablo Javier");
    expect(p?.contacto_nombre).toBe("Flexi Rigs");
  });

  it("sin CUIT, queda en null y no en cadena vacía", () => {
    const p = filaDeProveedor(
      ["Coresa", "Bolsones 1.20", "Leandro", "541157414905"], ENCABEZADO, 6
    );
    expect(p?.cuit).toBeNull();
  });

  it("descarta la fila sin nombre", () => {
    expect(filaDeProveedor(["", "", ""], ENCABEZADO, 20)).toBeNull();
  });
});
