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
 * ## Lo que enseñaron tres facturas reales (10/09/2026)
 *
 * Los nombres de los campos quedaron confirmados uno por uno contra la factura
 * A 0005-00003733 de TORRACO, cuyo QR trae el payload completo y bien formado.
 * Pero las otras dos mostraron que **no se puede suponer que el QR sea válido**:
 *
 * 1. **El base64 viene partido en líneas.** El de TORRACO trae un salto de
 *    línea cada 72 caracteres —envoltura MIME—, así que cortar en el blanco
 *    se queda con 72 de 290 caracteres y el JSON sale truncado. Se le saca todo
 *    el espacio en blanco antes de decodificar.
 *
 * 2. **Hay emisores que generan un QR inválido.** El de PEDRO H. CAMINO
 *    (factura A 0005-00003317) trae `"importe":38166,88` —coma decimal—, tabs
 *    de relleno después del número de comprobante, y está **cortado en 255
 *    caracteres**: un único segmento de 255 bytes en un QR versión 12, que
 *    admite 65.535. O sea, un generador con un buffer fijo.
 *
 *    `JSON.parse` lo rechaza entero. Pero los datos que identifican la factura
 *    —emisor, tipo, punto de venta, número, fecha, importe— están en el tramo
 *    legible, así que **rechazar todo por un carácter sería tirar una factura
 *    perfectamente identificable**. Cuando el JSON no parsea, se extrae campo
 *    por campo y se avisa que hubo que reparar.
 *
 * 3. **Hay facturas donde el QR no es una imagen aparte.** La de ZITO Y PRIOLA
 *    tiene la página entera como un JPEG: el QR existe pero está dentro de la
 *    imagen del comprobante. Para ésas hay que rasterizar la página y buscar el
 *    QR ahí, que es lo que hace el navegador al subir el archivo.
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
  /**
   * `true` si el QR no era un JSON válido y hubo que extraer campo por campo.
   *
   * Pasa de verdad: hay emisores con coma decimal y payload truncado. La
   * lectura sirve igual, pero merece una mirada humana antes de darla por buena.
   */
  reparado: boolean;
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

  let texto_json: string;
  try {
    texto_json = decodificarBase64(codificado);
  } catch {
    return { ok: false, motivo: "El parámetro `p` del QR no es base64." };
  }

  const leido = interpretar(texto_json);
  if (!leido) {
    return {
      ok: false,
      motivo:
        "El contenido del QR no se pudo interpretar como los datos de un comprobante. " +
        `Dice: ${texto_json.slice(0, 120)}`,
    };
  }

  const { datos, reparado } = leido;

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
      reparado,
    },
  };
}

/**
 * El JSON del QR, aunque no sea un JSON válido.
 *
 * Primero se intenta `JSON.parse`, que es lo que corresponde y lo que va a
 * funcionar con los emisores que respetan la especificación.
 *
 * Cuando falla se extrae **campo por campo**, y no es una concesión: la factura
 * A 0005-00003317 de PEDRO H. CAMINO trae `"importe":38166,88` con coma
 * decimal, tabs de relleno y el payload cortado en 255 caracteres. `JSON.parse`
 * la rechaza entera, pero el emisor, el tipo, el punto de venta, el número, la
 * fecha y el importe están todos en el tramo legible. Tirar una factura
 * identificable por un carácter mal puesto de otro sería devolverle el problema
 * a quien la está cargando.
 *
 * `reparado` viaja en la cabecera para que la pantalla pueda decir "esto salió
 * de un QR mal formado": un dato que hubo que reparar merece una mirada, aunque
 * la reparación sea correcta.
 */
function interpretar(texto: string): { datos: Record<string, unknown>; reparado: boolean } | null {
  try {
    const datos = JSON.parse(texto) as Record<string, unknown>;
    if (datos && typeof datos === "object" && !Array.isArray(datos)) {
      return { datos, reparado: false };
    }
  } catch {
    // Sigue abajo: hay emisores que no generan un JSON válido.
  }

  const datos: Record<string, unknown> = {};
  /*
   * Un campo es `"nombre": valor`, donde el valor puede ser un texto entre
   * comillas o un número —con punto o con coma decimal, que es el caso real—.
   * No se exige que el objeto cierre: un payload truncado igual sirve.
   */
  const campo = /"(\w+)"\s*:\s*(?:"([^"]*)"|(-?\d+(?:[.,]\d+)?))/g;

  for (const m of texto.matchAll(campo)) {
    const [, nombre, comoTexto, comoNumero] = m;
    if (comoTexto !== undefined) {
      datos[nombre] = comoTexto;
    } else if (comoNumero !== undefined) {
      // La coma decimal del emisor es un punto para todo el resto del mundo.
      datos[nombre] = Number(comoNumero.replace(",", "."));
    }
  }

  return Object.keys(datos).length ? { datos, reparado: true } : null;
}

/**
 * El parámetro `p` del QR.
 *
 * Se busca a mano y no con `new URL()` porque el contenido del QR no siempre es
 * una URL bien formada —hay emisores que guardan sólo el base64— y porque
 * fallar por el host sería rechazar facturas válidas: ARCA cambió el dominio.
 */
function parametroP(texto: string): string | null {
  /*
   * El `[^&]` incluye los saltos de línea a propósito: el QR de TORRACO trae el
   * base64 partido cada 72 caracteres, y una clase que excluya el espacio en
   * blanco se queda con 72 de 290 y devuelve un JSON truncado.
   */
  const conParametro = /[?&]p=([^&]+)/.exec(texto);
  if (conParametro) return decodeURIComponent(conParametro[1].replace(/\s+/g, ""));

  // Sin URL: puede ser el base64 pelado. Se acepta si al menos lo parece.
  const sinEspacios = texto.replace(/\s+/g, "");
  if (!sinEspacios.includes("://") && /^[A-Za-z0-9+/_=-]+$/.test(sinEspacios) && sinEspacios.length > 40) {
    return sinEspacios;
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
