/**
 * Copia a `public/pdfjs/` los dos archivos que el lector de facturas necesita
 * bajar por su cuenta desde el navegador.
 *
 * Facturación **rasteriza el PDF en el navegador** para encontrar el QR: hay
 * facturas donde el QR no es una imagen aparte sino parte de la imagen de la
 * página entera —la de ZITO Y PRIOLA es una sola foto escaneada—, y ahí la única
 * forma de leerlo es dibujar la página y buscarlo en los píxeles. Eso necesita:
 *
 *   1. **el worker de pdf.js**, que es quien dibuja;
 *   2. **el wasm de ZXing**, el segundo decodificador de QR — ver
 *      `lib/facturacion/escaneoQrZxing.ts`.
 *
 * Los dos se sirven como archivos estáticos en vez de pedírselos al bundler con
 * `new URL(…, import.meta.url)`:
 *
 * - Esa vía depende de qué bundler use Next —webpack o Turbopack, y en Next 16
 *   no es el mismo en dev que en build—, y si se rompe se rompe en el navegador
 *   de quien está cargando una factura, que es donde no lo vamos a ver: **casi
 *   todo el SdG está detrás del login y no se puede comprobar acá.**
 * - El archivo copiado, en cambio, o está o no está, y eso se ve en el build.
 *
 * Se copian en vez de commitearse porque la versión **tiene que coincidir** con
 * la del paquete instalado: pdf.js aborta si el worker es de otra versión, y el
 * wasm de ZXing lo carga un JavaScript que espera exactamente esos símbolos. Un
 * `npm update` arrastra el archivo solo. Corre desde `predev` y `prebuild`, así
 * que en Vercel pasa antes de compilar.
 *
 * Si falla, falla el build a propósito. Un archivo ausente no rompe la
 * compilación: rompe la lectura del QR, en silencio, y devuelve el módulo a
 * tipear todo a mano.
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "public", "pdfjs");

const ACTIVOS = [
  {
    paquete: "pdfjs-dist",
    origen: join(raiz, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
    destino: join(destino, "pdf.worker.min.mjs"),
    paraQue: "el buzón de Facturación no puede dibujar el PDF para buscarle el QR",
  },
  {
    paquete: "zxing-wasm",
    origen: join(raiz, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm"),
    destino: join(destino, "zxing_reader.wasm"),
    // Sin esto no se cae la carga: se cae el rescate de las que jsQR no lee.
    paraQue: "las facturas que jsQR no decodifica vuelven a quedar para carga manual",
  },
];

await mkdir(destino, { recursive: true });

for (const activo of ACTIVOS) {
  try {
    await copyFile(activo.origen, activo.destino);

    const version = JSON.parse(
      await readFile(join(raiz, "node_modules", activo.paquete, "package.json"), "utf8")
    ).version;

    console.log(`${activo.paquete} ${version}: copiado a ${activo.destino.replace(raiz, ".")}`);
  } catch (e) {
    console.error(
      `No se pudo copiar el activo de ${activo.paquete}.\n` +
        `  origen:  ${activo.origen}\n` +
        `  destino: ${activo.destino}\n` +
        `  sin él, ${activo.paraQue}.\n` +
        `Revisá que ${activo.paquete} esté instalado.\n`
    );
    console.error(e);
    process.exit(1);
  }
}
