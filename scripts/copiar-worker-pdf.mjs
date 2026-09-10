/**
 * Copia el worker de pdf.js a `public/`.
 *
 * Facturación necesita **rasterizar el PDF en el navegador** para encontrar el
 * QR: hay facturas donde el QR no es una imagen aparte sino parte de la imagen
 * de la página entera —la de ZITO Y PRIOLA es una sola foto escaneada—, y ahí la
 * única forma de leerlo es dibujar la página y buscarlo en los píxeles.
 *
 * pdf.js hace ese dibujo en un Web Worker, y hay que decirle de dónde bajarlo.
 * Las dos formas de resolverlo son pedírselo al bundler con `new URL(…,
 * import.meta.url)` o servirlo como un archivo estático. Va la segunda:
 *
 * - La primera depende de qué bundler use Next —webpack o Turbopack, y en Next
 *   16 no es el mismo en dev que en build—, y si se rompe se rompe en el
 *   navegador de quien está cargando una factura, que es donde no lo vamos a
 *   ver: **casi todo el SdG está detrás del login y no se puede comprobar acá.**
 * - El archivo copiado, en cambio, o está o no está, y eso se ve en el build.
 *
 * Se copia en vez de commitearse porque la versión **tiene que coincidir** con
 * la del paquete instalado: pdf.js aborta si el worker es de otra versión. Así,
 * un `npm update` de pdfjs-dist arrastra el worker solo. Corre desde `predev` y
 * `prebuild`, así que en Vercel pasa antes de compilar.
 *
 * Si falla, falla el build a propósito. Un worker ausente no rompe la
 * compilación: rompe la lectura del QR, en silencio, y devuelve el módulo a
 * tipear todo a mano.
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

const ORIGEN = join(raiz, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const DESTINO = join(raiz, "public", "pdfjs", "pdf.worker.min.mjs");

try {
  await mkdir(dirname(DESTINO), { recursive: true });
  await copyFile(ORIGEN, DESTINO);

  const version = JSON.parse(
    await readFile(join(raiz, "node_modules", "pdfjs-dist", "package.json"), "utf8")
  ).version;

  console.log(`pdf.js ${version}: worker copiado a public/pdfjs/pdf.worker.min.mjs`);
} catch (e) {
  console.error(
    "No se pudo copiar el worker de pdf.js.\n" +
      `  origen:  ${ORIGEN}\n` +
      `  destino: ${DESTINO}\n` +
      "Sin el worker, el buzón de Facturación no puede leer el QR de un PDF y\n" +
      "hay que tipear cada factura a mano. Revisá que pdfjs-dist esté instalado.\n"
  );
  console.error(e);
  process.exit(1);
}
