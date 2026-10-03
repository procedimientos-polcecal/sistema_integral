/**
 * El texto de un PDF, leído en el servidor.
 *
 * Existe para una sola cosa: que el webhook del correo pueda decidir si un
 * adjunto es una factura antes de meterlo en la bandeja. **No reemplaza al
 * lector del buzón**, que sigue corriendo en el navegador y es el que saca
 * emisor, número, fecha e importe — esto sólo mira si vale la pena mostrar el
 * archivo.
 *
 * ## Por qué sólo el texto y no el QR
 *
 * Leer el QR obliga a **dibujar la página**, y dibujar necesita un canvas: en
 * Node eso es `@napi-rs/canvas`, un binario nativo. Sacar el texto no necesita
 * nada —`getTextContent()` y listo—, anda sin los archivos de fuentes ni el
 * wasm de JBIG2, y tarda entre 20 y 700 ms por PDF. Medido contra las facturas
 * de verdad.
 *
 * El precio de no dibujar es que un PDF escaneado no dice nada. Eso no se tapa:
 * `reconocerLaFactura` lo devuelve como `dudoso` y el adjunto entra igual.
 *
 * ## Las tres primeras páginas
 *
 * El mismo límite que usa el lector del navegador, y por la misma razón: una
 * factura con remito adjunto llega como un PDF de dos o tres, y más allá de la
 * tercera el costo no se paga.
 */

import type { TextoOFallo } from "./correoEntrante";

const PAGINAS = 3;

/**
 * Devuelve el texto de las primeras páginas, o por qué no se pudo abrir.
 *
 * **Las dos ramas no son lo mismo y las dos importan.** Una cadena vacía es "se
 * abrió y no tiene capa de texto" —un escaneo, que es normal y pasa veinte
 * veces por mes—. `{ fallo }` es "no se pudo abrir", que es un defecto y hay
 * que poder verlo.
 *
 * Antes esto devolvía `string | null` y las dos cosas caían en el mismo `null`,
 * así que un bug real se mostraba en pantalla como "es un escaneo". Costó una
 * tarde: las tres facturas de prueba decían ser escaneos y una de ellas tenía
 * 1.718 caracteres de texto medidos. Un diagnóstico que no se distingue de la
 * operación normal no es un diagnóstico.
 */
export async function textoDelPdf(bytes: Uint8Array): Promise<TextoOFallo> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    await prepararElWorker();
    const documento = await pdfjs.getDocument({
      data: copiaPlana(bytes),
      /*
       * Sin `standardFontDataUrl` ni `wasmUrl` a propósito: en Vercel esos
       * archivos no están servidos y para sacar texto no hacen falta. Lo único
       * que se pierde son unos avisos en el log.
       */
      useSystemFonts: false,
    }).promise;

    let todo = "";
    for (let n = 1; n <= Math.min(documento.numPages, PAGINAS); n++) {
      const contenido = await (await documento.getPage(n)).getTextContent();
      for (const item of contenido.items) {
        if ("str" in item) todo += `${item.str} `;
      }
    }

    return todo;
  } catch (e) {
    // Sin traducir: lo que dijo pdf.js es lo único que sirve para diagnosticar.
    return { fallo: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Deja el worker de pdf.js donde la librería lo va a encontrar.
 *
 * En Node no hay `Worker`, así que pdf.js corre el suyo **en el mismo hilo** y
 * lo carga con un `import()` relativo a su propio archivo. Dentro de Next eso
 * no resuelve: el bundler reescribió `pdf.mjs` a un chunk en `.next/` y el
 * worker quedó buscándose como `.next/dev/server/chunks/pdf.worker.mjs`, que no
 * existe. El error textual, que vale más que cualquier paráfrasis:
 *
 *   Setting up fake worker failed: "Cannot find module
 *   '...\.next\dev\server\chunks\pdf.worker.mjs'"
 *
 * La librería mira `globalThis.pdfjsWorker` **antes** de intentar ese import
 * (`PDFWorker.#mainThreadWorkerMessageHandler`), así que alcanza con dejárselo
 * puesto: el especificador acá es literal y el bundler sí lo resuelve.
 *
 * Esto no se nota en un script suelto —ahí el import relativo anda— y por eso
 * el banco de pruebas pasaba en verde mientras la ruta fallaba en todas. Vale
 * para cualquier módulo que quiera usar pdf.js del lado del servidor.
 */
async function prepararElWorker(): Promise<void> {
  const global = globalThis as { pdfjsWorker?: unknown };
  if (global.pdfjsWorker) return;
  global.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
}

/**
 * Un `Uint8Array` de verdad, con su propio buffer.
 *
 * Dos razones, y cada una sola ya alcanza:
 *
 * 1. **pdf.js rechaza un `Buffer`** con un error explícito
 *    (`Please provide binary data as Uint8Array, rather than Buffer`), y un
 *    `Buffer` **es** un `Uint8Array` para TypeScript, así que `tsc` no puede
 *    avisar. El webhook arma los bytes con `Buffer.from(base64)`: sin esto,
 *    cada PDF que llega por mail tira ahí adentro.
 * 2. **pdf.js se queda con el buffer** —lo puede dejar vacío al terminar— y el
 *    webhook vuelve a usar los mismos bytes después, para subir el archivo al
 *    bucket. Encima los `Buffer` de Node salen de un pool compartido. Copiar
 *    unos cientos de KB cuesta nada al lado de los 20 ms que tarda el parseo.
 */
function copiaPlana(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}
