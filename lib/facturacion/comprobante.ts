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

/**
 * La letra del comprobante, que es lo que decide si trae IVA discriminado.
 *
 * No es cosmética: de eso depende cómo se arma el borrador en Odoo. Medido
 * contra los 1.143 comprobantes con referencia cargada del grupo (10/09/2026):
 *
 * | Letra | Comprobantes | Con impuesto |
 * |---|---|---|
 * | A | 793 | **793 (100%)**, y 778 al 21% exacto |
 * | B | 5 | 5 |
 * | C | 4 | **0** |
 *
 * O sea: una A o una B se cargan con IVA, una C no lleva —el monotributista no
 * lo discrimina— y ponérselo sería inventar un crédito fiscal que no existe.
 */
export type LetraDeComprobante = "A" | "B" | "C" | "E" | "M";

/**
 * Sigla y letra por código de ARCA.
 *
 * La sigla es la que **ya usa administración** al cargar en Odoo: `FC A`,
 * `FCE A`, `NC A`. Se respeta al pie porque el que la lee después es un humano
 * buscando en Odoo, y lo que busca es lo que está acostumbrado a escribir.
 */
const COMPROBANTES: Record<number, { sigla: string; letra: LetraDeComprobante }> = {
  1: { sigla: "FC A", letra: "A" },
  2: { sigla: "ND A", letra: "A" },
  3: { sigla: "NC A", letra: "A" },
  4: { sigla: "RC A", letra: "A" },
  6: { sigla: "FC B", letra: "B" },
  7: { sigla: "ND B", letra: "B" },
  8: { sigla: "NC B", letra: "B" },
  9: { sigla: "RC B", letra: "B" },
  11: { sigla: "FC C", letra: "C" },
  12: { sigla: "ND C", letra: "C" },
  13: { sigla: "NC C", letra: "C" },
  15: { sigla: "RC C", letra: "C" },
  19: { sigla: "FC E", letra: "E" },
  20: { sigla: "ND E", letra: "E" },
  21: { sigla: "NC E", letra: "E" },
  51: { sigla: "FC M", letra: "M" },
  52: { sigla: "ND M", letra: "M" },
  53: { sigla: "NC M", letra: "M" },
  54: { sigla: "RC M", letra: "M" },
  201: { sigla: "FCE A", letra: "A" },
  202: { sigla: "ND FCE A", letra: "A" },
  203: { sigla: "NC FCE A", letra: "A" },
  206: { sigla: "FCE B", letra: "B" },
  207: { sigla: "ND FCE B", letra: "B" },
  208: { sigla: "NC FCE B", letra: "B" },
  211: { sigla: "FCE C", letra: "C" },
  212: { sigla: "ND FCE C", letra: "C" },
  213: { sigla: "NC FCE C", letra: "C" },
};

/** La letra, o `null` si el código no es uno de los que el grupo puede recibir. */
export function letraDelComprobante(tipo: number | null | undefined): LetraDeComprobante | null {
  return typeof tipo === "number" ? (COMPROBANTES[tipo]?.letra ?? null) : null;
}

/**
 * Si el comprobante discrimina IVA.
 *
 * Ante un tipo desconocido devuelve `false`: un borrador sin impuesto se
 * completa mirándolo, uno con un impuesto inventado se postea sin que nadie
 * note que el crédito fiscal no correspondía.
 */
export function discriminaIva(tipo: number | null | undefined): boolean {
  const letra = letraDelComprobante(tipo);
  return letra === "A" || letra === "B" || letra === "M";
}

/**
 * La referencia con la que la factura se escribe en Odoo: `FC A 00006-00010192`.
 *
 * **Punto de venta en cinco dígitos**, aunque el comprobante lo imprima en
 * cuatro. Es como está escrito el corpus del grupo —1.745 de 1.959 números
 * cargados usan cinco—, y quien va a buscar esta factura en Odoo la va a buscar
 * así. El código que la vuelve a leer parsea enteros, así que el relleno no
 * cambia nada para la máquina; cambia para la persona.
 */
export function referenciaParaOdoo(c: {
  tipoComprobante?: number | null;
  puntoVenta?: number | null;
  numero?: number | null;
}): string | null {
  if (typeof c.puntoVenta !== "number" || typeof c.numero !== "number") return null;

  const sigla =
    typeof c.tipoComprobante === "number" ? COMPROBANTES[c.tipoComprobante]?.sigla : undefined;
  const numero = `${String(c.puntoVenta).padStart(5, "0")}-${String(c.numero).padStart(8, "0")}`;

  return sigla ? `${sigla} ${numero}` : numero;
}
