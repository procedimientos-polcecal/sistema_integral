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

const PAGINAS = 3;

/**
 * Devuelve el texto, o `null` si el PDF no se pudo abrir.
 *
 * `null` y cadena vacía no son lo mismo y los dos importan: vacío es "se abrió
 * y no tiene capa de texto" —un escaneo—, y `null` es "no se pudo abrir". Los
 * dos terminan en `dudoso`, pero el motivo que se guarda es distinto.
 */
export async function textoDelPdf(bytes: Uint8Array): Promise<string | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const documento = await pdfjs.getDocument({
      data: bytes,
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
  } catch {
    // Un PDF roto, cifrado o que no es un PDF. No se grita: el adjunto entra
    // como dudoso y lo mira una persona.
    return null;
  }
}
