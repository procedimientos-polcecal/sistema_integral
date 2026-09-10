/**
 * Leer el QR de una factura electrónica argentina.
 *
 * Toda factura electrónica lleva un QR con los datos del comprobante, así que
 * identificarla no requiere OCR ni adivinanza: el dato está ahí, exacto. Es la
 * diferencia entre transcribir una factura y reconocerla.
 *
 * El QR contiene una URL con un JSON en base64:
 *
 *     https://www.arca.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoi...
 *
 * **El dominio cambió**: AFIP pasó a llamarse ARCA, así que las facturas viejas
 * traen `afip.gob.ar` y las nuevas `arca.gob.ar`. Se aceptan las dos, y en
 * realidad cualquier host: lo que importa es el parámetro `p`. Rechazar por el
 * dominio sería fallar con facturas perfectamente válidas.
 *
 * ## Lo que este lector NO hace
 *
 * No valida el CAE contra ARCA ni verifica que la factura exista. Lee lo que el
 * emisor escribió en el QR. Alcanza para identificar el comprobante y evitar
 * cargarlo dos veces, que es para lo que está.
 *
 * ## Cuando algo no encaja, lo dice
 *
 * Los nombres de los campos salen de la especificación pública de ARCA, pero
 * **todavía no se confirmaron contra una factura real del grupo**. Por eso,
 * cuando el JSON no trae lo que se espera, el motivo **incluye las claves que
 * sí trajo**: la primera factura que se suba va a decir la verdad en el acto,
 * en vez de fallar en silencio y dejar a alguien adivinando.
 */

import { normalizarCuit } from "@/lib/core/cuit";

export interface CabeceraDelComprobante {
  /** Versión del formato del QR. Hoy, 1. */
  version: number;
  /** Fecha de emisión, en ISO (`2026-09-10`). */
  fecha: string;
  /** CUIT del emisor, once dígitos sin guiones. */
  cuitEmisor: string;
  puntoVenta: number;
  /** Código de tipo de comprobante de ARCA: 1 factura A, 6 B, 11 C… */
  tipoComprobante: number;
  numero: number;
  importeTotal: number;
  /** `PES` o `DOL`, tal como lo escribe ARCA. */
  moneda: string;
  /** Cotización de la moneda. 1 cuando es en pesos. */
  cotizacion: number | null;
  /**
   * CUIT del receptor, si el comprobante lo lleva.
   *
   * Es el que dice **a cuál de las dos empresas se le facturó**, así que ahorra
   * elegirlo a mano. Sólo se toma cuando el tipo de documento es CUIT (80): un
   * DNI en ese campo no es una empresa del grupo.
   */
  cuitReceptor: string | null;
  tipoDocReceptor: number | null;
  /** El CAE, o el CAEA según `tipoCae`. */
  cae: string | null;
  /** `E` = CAE, `A` = CAEA. */
  tipoCae: string | null;
}

export type LecturaDelQr =
  | { ok: true; cabecera: CabeceraDelComprobante }
  | { ok: false; motivo: string };

/** Tipo de documento "CUIT" en las tablas de ARCA. */
const TIPO_DOC_CUIT = 80;

/** Sin estos campos no se puede identificar el comprobante. */
const IMPRESCINDIBLES = ["cuit", "ptoVta", "tipoCmp", "nroCmp", "importe"] as const;

export function leerQrAfip(texto: string): LecturaDelQr {
  const crudo = (texto ?? "").trim();
  if (!crudo) return { ok: false, motivo: "El código está vacío." };

  const codificado = parametroP(crudo);
  if (!codificado) {
    return {
      ok: false,
      motivo:
        "El código no parece el QR de una factura electrónica: no tiene el parámetro `p` " +
        `con los datos. Dice: ${crudo.slice(0, 80)}`,
    };
  }

  let datos: Record<string, unknown>;
  try {
    datos = JSON.parse(decodificarBase64(codificado)) as Record<string, unknown>;
  } catch {
    return { ok: false, motivo: "El QR tiene un parámetro `p` que no es un JSON en base64." };
  }

  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    return { ok: false, motivo: "El contenido del QR no es un objeto JSON." };
  }

  const faltan = IMPRESCINDIBLES.filter((c) => datos[c] === undefined || datos[c] === null);
  if (faltan.length) {
    /*
     * Acá está la red de seguridad: se dice qué falta **y qué vino**. Si algún
     * día ARCA renombra un campo, o el emisor usa otro formato, la primera
     * factura que se suba lo muestra en pantalla en vez de fallar sin explicar.
     */
    return {
      ok: false,
      motivo:
        `Al QR le faltan campos que hacen falta para identificar la factura: ${faltan.join(", ")}. ` +
        `Los que trajo son: ${Object.keys(datos).join(", ") || "ninguno"}.`,
    };
  }

  const cuitEmisor = normalizarCuit(String(datos.cuit));
  if (!cuitEmisor) {
    return { ok: false, motivo: `El CUIT del emisor no tiene once dígitos: ${String(datos.cuit)}` };
  }

  const importeTotal = numero(datos.importe);
  if (importeTotal === null) {
    return { ok: false, motivo: `El importe del QR no es un número: ${String(datos.importe)}` };
  }

  const tipoDocReceptor = entero(datos.tipoDocRec);
  const docReceptor = datos.nroDocRec === undefined ? null : String(datos.nroDocRec);

  return {
    ok: true,
    cabecera: {
      version: entero(datos.ver) ?? 1,
      fecha: fechaISO(datos.fecha),
      cuitEmisor,
      puntoVenta: entero(datos.ptoVta) ?? 0,
      tipoComprobante: entero(datos.tipoCmp) ?? 0,
      numero: entero(datos.nroCmp) ?? 0,
      importeTotal,
      moneda: typeof datos.moneda === "string" ? datos.moneda : "PES",
      cotizacion: numero(datos.ctz),
      // Sólo si es un CUIT: un DNI en ese campo no identifica a una empresa.
      cuitReceptor: tipoDocReceptor === TIPO_DOC_CUIT ? normalizarCuit(docReceptor) : null,
      tipoDocReceptor,
      cae: datos.codAut === undefined || datos.codAut === null ? null : String(datos.codAut),
      tipoCae: typeof datos.tipoCodAut === "string" ? datos.tipoCodAut : null,
    },
  };
}

/**
 * El parámetro `p` del QR.
 *
 * Se busca a mano y no con `new URL()` porque el contenido del QR no siempre es
 * una URL bien formada —hay emisores que guardan sólo el base64— y porque
 * fallar por el host sería rechazar facturas válidas: ARCA cambió el dominio.
 */
function parametroP(texto: string): string | null {
  const conParametro = /[?&]p=([^&\s]+)/.exec(texto);
  if (conParametro) return decodeURIComponent(conParametro[1]);

  // Sin URL: puede ser el base64 pelado. Se acepta si al menos lo parece.
  if (!texto.includes("://") && /^[A-Za-z0-9+/_=-]+$/.test(texto) && texto.length > 40) {
    return texto;
  }

  return null;
}

/**
 * Base64 → texto, aguantando la variante URL-safe y el relleno faltante.
 *
 * ARCA usa base64 común, pero pasa por una query string: hay emisores que lo
 * escriben con `-` y `_`, y otros que le comen el `=` del final. Las tres formas
 * son el mismo dato y ninguna justifica rechazar una factura.
 *
 * Se decodifica por bytes y no con `atob` directo porque el JSON puede traer
 * acentos —el nombre de un emisor— y `atob` devuelve una cadena binaria que los
 * rompe.
 */
function decodificarBase64(valor: string): string {
  const normalizado = valor.replace(/-/g, "+").replace(/_/g, "/");
  const conRelleno = normalizado.padEnd(
    normalizado.length + ((4 - (normalizado.length % 4)) % 4),
    "="
  );

  const binario = atob(conRelleno);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** La fecha del QR viene como `2026-09-10`. Se deja como está si ya es ISO. */
function fechaISO(valor: unknown): string {
  const texto = String(valor ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : "";
}

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function entero(valor: unknown): number | null {
  const n = numero(valor);
  return n === null ? null : Math.trunc(n);
}
