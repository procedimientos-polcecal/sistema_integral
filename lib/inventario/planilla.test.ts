import { describe, it, expect } from "vitest";
import {
  mapearListado, mapearKardex, filaDeArticulo, filaDeMovimiento, cantidad,
} from "./planilla";

const ENC_LISTADO = [
  "CODIGO", "DESCRIPCION", "STOCK INICIAL", "UBICACION",
  "PROVEEDOR", "MARCA", "STOCK ACTUAL", "STOCK DE SEGURIDAD",
];
const idxListado = mapearListado(ENC_LISTADO);

const ENC_KARDEX = [
  "N° RI", "CODIGO", "DESCRIPCION", "ENTRADA", "SALIDA",
  "QUIEN", "STOCK", "FECHA", "PROVEEDOR", "SECTOR",
];
const idxKardex = mapearKardex(ENC_KARDEX);

describe("mapear los encabezados", () => {
  it("encuentra cada columna del listado", () => {
    expect(idxListado.codigo).toBe(0);
    expect(idxListado.stockActual).toBe(6);
    expect(idxListado.stockSeguridad).toBe(7);
  });

  /** Los encabezados escriben "N°" de varias maneras. */
  it("no se pierde por acentos, mayusculas ni el simbolo de grado", () => {
    const i = mapearKardex(["n ri", "Código", "Descripción", "entrada"]);
    expect(i.ri).toBe(0);
    expect(i.codigo).toBe(1);
    expect(i.entrada).toBe(3);
  });

  it("una columna que la planilla no trae queda en -1", () => {
    const i = mapearListado(["CODIGO", "DESCRIPCION"]);
    expect(i.marcas).toBe(-1);
    expect(i.stockActual).toBe(-1);
  });

  /**
   * Se lee por encabezado y no por posicion justamente para esto: alguien
   * inserta una columna y todo lo de la derecha se corre.
   */
  it("sigue encontrando las columnas si alguien inserta una al principio", () => {
    const i = mapearListado(["NUEVA", ...ENC_LISTADO]);
    expect(i.codigo).toBe(1);
    expect(i.stockActual).toBe(7);
  });
});

describe("una cantidad de la planilla", () => {
  /**
   * Vacio no es cero: "nadie lo conto" y "no hay" son distintos, y confundirlos
   * manda a comprar algo que puede estar.
   */
  it("vacio y guion son null, no cero", () => {
    expect(cantidad("")).toBeNull();
    expect(cantidad("  ")).toBeNull();
    expect(cantidad("-")).toBeNull();
    expect(cantidad(null)).toBeNull();
    expect(cantidad(undefined)).toBeNull();
  });

  it("un cero escrito si es cero", () => {
    expect(cantidad(0)).toBe(0);
    expect(cantidad("0")).toBe(0);
  });

  it("lee el formato argentino que sale de tipear a mano", () => {
    expect(cantidad("1.250")).toBe(1250);
    expect(cantidad("12,5")).toBe(12.5);
    expect(cantidad(37)).toBe(37);
  });

  it("lo ilegible es null y no un cero silencioso", () => {
    expect(cantidad("s/d")).toBeNull();
  });
});

describe("una fila del listado", () => {
  const fila = ["00469", "GUANTES DE DESCARNE", 100, "PAÑOL", "Acme SA", "3M", 42, 10];

  it("lee el articulo completo", () => {
    expect(filaDeArticulo(fila, idxListado, 5)).toEqual({
      codigo: "00469",
      descripcion: "GUANTES DE DESCARNE",
      ubicacion: "PAÑOL",
      proveedores_ref: "Acme SA",
      marcas: "3M",
      stock_inicial: 100,
      stock_actual: 42,
      stock_seguridad: 10,
      stock_planilla: 42,
      sheets_fila: 5,
    });
  });

  /** Los ceros a la izquierda son parte del codigo: sin ellos es otro articulo. */
  it("el codigo es texto y conserva los ceros de adelante", () => {
    expect(filaDeArticulo(fila, idxListado, 5)?.codigo).toBe("00469");
  });

  it("sin codigo o sin descripcion no es un articulo", () => {
    expect(filaDeArticulo(["", "ALGO"], idxListado, 2)).toBeNull();
    expect(filaDeArticulo(["00470", ""], idxListado, 3)).toBeNull();
  });

  /**
   * `stock_actual` cae a cero para poder operar, pero `stock_planilla` guarda
   * null: cero es "no hay" y vacio es "nadie lo conto", y la pantalla de
   * repuestos de Mantenimiento los distingue.
   */
  it("un stock vacio es cero para operar y null para saber si lo contaron", () => {
    const a = filaDeArticulo(["00471", "ARANDELA", "", "", "", "", "", ""], idxListado, 9);
    expect(a).toMatchObject({ stock_inicial: 0, stock_actual: 0, stock_seguridad: 0 });
    expect(a?.stock_planilla).toBeNull();
  });

  it("un cero escrito en la planilla si queda como cero, no como null", () => {
    const a = filaDeArticulo(["00472", "BULON", "", "", "", "", 0, 5], idxListado, 10);
    expect(a?.stock_actual).toBe(0);
    expect(a?.stock_planilla).toBe(0);
  });
});

describe("una fila del kardex", () => {
  const salida = [1865, "00469", "GUANTES", "", 5, "Lopez", 37, "12/8/2026", "", "MANTENIMIENTO"];
  const entrada = ["", "00469", "GUANTES", 20, "", "", 57, "13/8/2026", "Acme SA", ""];

  it("una salida se lee como salida", () => {
    expect(filaDeMovimiento(salida, idxKardex, 402)).toEqual({
      ri: 1865,
      codigo: "00469",
      descripcion: "GUANTES",
      tipo: "salida",
      cantidad: 5,
      stock_resultante: 37,
      solicitante: "Lopez",
      fecha: "2026-08-12",
      proveedor_raw: null,
      sector_raw: "MANTENIMIENTO",
      sheets_fila: 402,
    });
  });

  it("una entrada se lee como entrada y puede no tener RI", () => {
    const m = filaDeMovimiento(entrada, idxKardex, 403);
    expect(m).toMatchObject({ tipo: "entrada", cantidad: 20, ri: null, proveedor_raw: "Acme SA" });
  });

  /** Es la columna que dice si la fila tiene datos. */
  it("sin codigo no es un movimiento", () => {
    expect(filaDeMovimiento(["", "", "", 5], idxKardex, 900)).toBeNull();
  });

  /**
   * Nadie mueve un articulo para los dos lados a la vez: es una fila mal
   * cargada, y elegir cual vale seria inventar.
   */
  it("con entrada y salida a la vez se descarta", () => {
    const rota = [null, "00469", "GUANTES", 3, 5, "", "", "", "", ""];
    expect(filaDeMovimiento(rota, idxKardex, 404)).toBeNull();
  });

  it("sin entrada ni salida se descarta", () => {
    const vacia = [null, "00469", "GUANTES", "", "", "", "", "", "", ""];
    expect(filaDeMovimiento(vacia, idxKardex, 405)).toBeNull();
  });

  it("un cero no cuenta como movimiento", () => {
    const cero = [null, "00469", "GUANTES", 0, 0, "", "", "", "", ""];
    expect(filaDeMovimiento(cero, idxKardex, 406)).toBeNull();
  });

  /**
   * El dia y el mes dados vuelta ya costaron 885 registros en Compras: la
   * planilla escribe d/m y no m/d.
   */
  it("lee la fecha en d/m, que es como la escribe la planilla", () => {
    const m = filaDeMovimiento(
      [null, "00469", "G", "", 1, "", "", "5/9/2026", "", ""],
      idxKardex,
      407
    );
    expect(m?.fecha).toBe("2026-09-05");
  });

  it("sin fecha el movimiento existe igual", () => {
    const m = filaDeMovimiento([null, "00469", "G", "", 1, "", "", "", "", ""], idxKardex, 408);
    expect(m?.fecha).toBeNull();
    expect(m?.tipo).toBe("salida");
  });

  /** Un guion suelto es "aca no va nada", igual que en el resto del SdG. */
  it("un guion suelto no es un solicitante", () => {
    const m = filaDeMovimiento(
      [null, "00469", "G", "", 1, "-", "", "", "-", "-"],
      idxKardex,
      409
    );
    expect(m?.solicitante).toBeNull();
    expect(m?.proveedor_raw).toBeNull();
    expect(m?.sector_raw).toBeNull();
  });

  it("un RI que no es un entero positivo no se guarda", () => {
    const m = filaDeMovimiento(
      ["s/n", "00469", "G", "", 1, "", "", "", "", ""],
      idxKardex,
      410
    );
    expect(m?.ri).toBeNull();
  });
});
