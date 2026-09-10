/**
 * Qué comprobante es, y cómo se lo nombra.
 *
 * El QR trae el tipo como un número —`tipoCmp`— y nadie en administración habla
 * en números: hablan de "una factura A" o "una nota de crédito". Traducirlo es
 * lo que permite que la pantalla diga lo mismo que el papel que la persona tiene
 * en la mano.
 *
 * Los códigos son la tabla de tipos de comprobante de AFIP/ARCA. Están los que
 * el grupo puede recibir de un proveedor; el resto cae en el genérico, que dice
 * el número en vez de inventar un nombre.
 */

export const TIPOS_DE_COMPROBANTE: Record<number, string> = {
  1: "Factura A",
  2: "Nota de débito A",
  3: "Nota de crédito A",
  4: "Recibo A",
  6: "Factura B",
  7: "Nota de débito B",
  8: "Nota de crédito B",
  9: "Recibo B",
  11: "Factura C",
  12: "Nota de débito C",
  13: "Nota de crédito C",
  15: "Recibo C",
  19: "Factura E",
  20: "Nota de débito E",
  21: "Nota de crédito E",
  51: "Factura M",
  52: "Nota de débito M",
  53: "Nota de crédito M",
  54: "Recibo M",
  // Factura de Crédito Electrónica MiPyME. Un proveedor chico puede emitirla en
  // vez de la factura común, y para el buzón es una factura igual.
  201: "Factura de crédito A",
  202: "Nota de débito FCE A",
  203: "Nota de crédito FCE A",
  206: "Factura de crédito B",
  207: "Nota de débito FCE B",
  208: "Nota de crédito FCE B",
  211: "Factura de crédito C",
  212: "Nota de débito FCE C",
  213: "Nota de crédito FCE C",
};

/** "Factura A", o "Comprobante tipo 88" si es uno que no está en la tabla. */
export function nombreDelTipo(tipo: number | null | undefined): string {
  if (typeof tipo !== "number" || !Number.isFinite(tipo)) return "Comprobante";
  return TIPOS_DE_COMPROBANTE[tipo] ?? `Comprobante tipo ${tipo}`;
}

/**
 * Una nota de crédito **resta**.
 *
 * No es un detalle de presentación: si se suman los importes del buzón sin
 * separarlas, el total dice más de lo que el grupo debe. Los códigos de crédito
 * son 3, 8, 13, 21, 53 y los tres de FCE.
 */
const CREDITOS = new Set([3, 8, 13, 21, 53, 203, 208, 213]);

export function esNotaDeCredito(tipo: number | null | undefined): boolean {
  return typeof tipo === "number" && CREDITOS.has(tipo);
}

/**
 * Cómo se escribe el número de un comprobante: punto de venta en cuatro
 * dígitos, número en ocho. Es como sale impreso, y como lo nombran los archivos
 * que llegan por mail ("POLCECAL SA-Factura A-0005-00003733").
 */
export function numeroFormateado(
  puntoVenta: number | null | undefined,
  numero: number | null | undefined
): string {
  const pv = typeof puntoVenta === "number" ? String(puntoVenta).padStart(4, "0") : "????";
  const nro = typeof numero === "number" ? String(numero).padStart(8, "0") : "????????";
  return `${pv}-${nro}`;
}

/** "Factura A 0005-00003733": el nombre completo, para títulos y avisos. */
export function nombreDelComprobante(c: {
  tipoComprobante?: number | null;
  puntoVenta?: number | null;
  numero?: number | null;
}): string {
  return `${nombreDelTipo(c.tipoComprobante)} ${numeroFormateado(c.puntoVenta, c.numero)}`;
}

/**
 * La clave natural: los cuatro datos que identifican un comprobante en la
 * Argentina. Es la que usa el índice único del buzón, y la que hace que la
 * misma factura entrada por mail y en papel sea una fila y no dos.
 */
export interface ClaveNatural {
  cuit_emisor: string;
  tipo_comprobante: number;
  punto_venta: number;
  numero: number;
}

/**
 * La clave, o `null` si falta algún dato.
 *
 * Devuelve `null` en vez de completar con ceros a propósito: una factura en
 * papel mal escaneada entra al buzón igual —el buzón nunca se bloquea— pero
 * entra **sin clave**, y entonces no se la puede detectar como duplicada. Es
 * mejor que una clave inventada, que haría que dos comprobantes distintos
 * choquen entre sí en el índice único.
 */
export function claveNatural(c: {
  cuitEmisor?: string | null;
  tipoComprobante?: number | null;
  puntoVenta?: number | null;
  numero?: number | null;
}): ClaveNatural | null {
  if (!c.cuitEmisor || !/^\d{11}$/.test(c.cuitEmisor)) return null;
  if (typeof c.tipoComprobante !== "number") return null;
  if (typeof c.puntoVenta !== "number") return null;
  if (typeof c.numero !== "number") return null;
  return {
    cuit_emisor: c.cuitEmisor,
    tipo_comprobante: c.tipoComprobante,
    punto_venta: c.puntoVenta,
    numero: c.numero,
  };
}
