import { conMargenBlanco, rincones, type PixelesDe, type Pixeles } from "./escaneoQr";

/**
 * Segunda opinión sobre el QR, con el ZXing de verdad compilado a WebAssembly.
 *
 * ## Por qué hace falta un segundo decodificador
 *
 * Había facturas que **no se decodificaban aunque se vieran impecables**. Se
 * probó a 7000 px, con umbral duro y con 274 ventanas: no era resolución, era
 * jsQR. Es un port en JavaScript y su corrección de errores se rinde antes que
 * la implementación original.
 *
 * Medido con `scripts/banco-de-qr.mts` sobre las **187 facturas de septiembre de
 * 2026**, la carpeta entera: **rescata 30**, todas en la primera pasada a 1600
 * px. Diez son de REPUESTOS AGRÍCOLAS COLON, tres de DON ALFREDO, dos de TODO
 * RULEMAN, y ahí están también AGROINGA —que antes necesitaba las 274 ventanas—
 * y las de PEDRO H. CAMINO.
 *
 * El banco corrigió dos cosas que estaban escritas acá:
 *
 * - **El QR de TODO RULEMAN sí se lee.** Se lo había dado por perdido mirando un
 *   PNG de 1400 px; con el PDF de verdad dibujado a 1600, zxing lo lee. Medir
 *   sobre un derivado no es medir.
 * - **RUBIALES no era un problema de decodificador**: esas facturas **no traen
 *   QR**. Salen por el lector de texto.
 *
 * ## Por qué no reemplaza a jsQR
 *
 * Porque jsQR resuelve 121 de 187 solo y **no cuesta una descarga**. El wasm son
 * 950 KB: se baja sólo cuando jsQR falló, o sea en las facturas que antes se
 * tipeaban a mano. Quien carga una factura normal no paga nada.
 *
 * Por eso el orden es jsQR primero y esto después, y por eso el módulo se
 * importa con `import()` dinámico: si nunca se lo llama, no entra al bundle que
 * baja el navegador.
 *
 * Y por eso, también, **la pasada de ventanas quedó en cero rescates**: todo lo
 * que antes necesitaba 2600 px, 3600 px o 274 ventanas ahora lo resuelve zxing
 * en el primer intento. Se deja igual, porque cuesta sólo en las que ya iban a
 * fallar.
 */

/** El wasm se sirve como archivo estático, igual que el worker de pdf.js. */
const RUTA_DEL_WASM = "/pdfjs/zxing_reader.wasm";

/**
 * "Dame el texto del QR que haya en estos píxeles."
 *
 * Es el mismo tipo de costura que `PixelesDe` en `escaneoQr.ts`: el navegador
 * baja el wasm por HTTP y el banco de pruebas lo carga del disco, pero la
 * búsqueda —la hoja entera, después los rincones— es la misma función y no una
 * copia parecida. Sin esto, lo que se mide contra las facturas reales no sería
 * lo que corre en producción.
 */
export type Lector = (p: Pixeles) => Promise<string | null>;

let preparando: Promise<Lector> | null = null;

/**
 * Carga el módulo una sola vez, aunque lo llamen veinte facturas seguidas.
 *
 * Se guarda la **promesa** y no el resultado: con una cola de facturas, dos
 * lecturas arrancan antes de que la primera termine de bajar el wasm, y guardar
 * el resultado haría que las dos lo bajaran.
 */
function prepararElLector(): Promise<Lector> {
  preparando ??= (async () => {
    const { readBarcodes, prepareZXingModule } = await import("zxing-wasm/reader");

    await prepareZXingModule({
      overrides: {
        locateFile: (ruta: string, prefijo: string) =>
          ruta.endsWith(".wasm") ? RUTA_DEL_WASM : prefijo + ruta,
      },
      fireImmediately: true,
    });

    return (p: Pixeles) => leerConZxing(readBarcodes, p);
  })();

  return preparando;
}

/**
 * Las opciones con las que se le pregunta a ZXing, en un solo lugar.
 *
 * Están acá y no adentro de `prepararElLector` para que el banco de pruebas
 * —que arranca el wasm de otra manera, porque en Node no hay de dónde bajarlo—
 * pregunte **exactamente lo mismo** que el navegador. Un banco que midiera con
 * otras opciones mediría otra cosa.
 */
export async function leerConZxing(
  readBarcodes: (
    imagen: ImageData,
    opciones: Record<string, unknown>
  ) => Promise<{ text: string }[]>,
  p: Pixeles
): Promise<string | null> {
  const encontrados = await readBarcodes(
    {
      /*
       * El cast es por un detalle de tipos, no de datos: desde TypeScript 5.7
       * `Uint8ClampedArray` lleva el tipo de su buffer, y zxing pide uno
       * respaldado por `ArrayBuffer` mientras que el nuestro admite también
       * `SharedArrayBuffer`. Acá los píxeles siempre salen de un canvas o de
       * `conMargenBlanco`, y ninguno de los dos devuelve memoria compartida.
       */
      data: p.data as Uint8ClampedArray<ArrayBuffer>,
      width: p.width,
      height: p.height,
      // `conMargenBlanco` arma un objeto plano, no un `ImageData` del navegador,
      // así que el espacio de color hay que declararlo. Es el que tiene un
      // canvas por defecto.
      colorSpace: "srgb",
    } satisfies ImageData,
    {
      formats: ["QRCode"],
      // `tryHarder` es justamente lo que jsQR no hace; `tryInvert` cubre los
      // comprobantes impresos en negativo y `tryRotate` los escaneos torcidos.
      // Sobre una hoja A4 esto son decenas de milisegundos.
      tryHarder: true,
      tryInvert: true,
      tryRotate: true,
    }
  );

  return encontrados.find((b) => b.text)?.text ?? null;
}

async function recortar(
  lector: Lector,
  px: PixelesDe,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<string | null> {
  if (w < 40 || h < 40) return null;
  try {
    const d = px.getImageData(Math.max(0, x), Math.max(0, y), w, h);
    // El mismo margen blanco que la pasada de jsQR: la zona de silencio que el
    // estándar pide y que muchos emisores no dejan.
    return await lector(conMargenBlanco({ data: d.data, width: d.width, height: d.height }));
  } catch {
    return null;
  }
}

/**
 * La hoja completa y después los cuatro rincones, con la misma geometría que
 * `buscarQr`.
 *
 * Devuelve `[]` —y no tira— si el wasm no se pudo bajar: sin él la factura se
 * carga igual completando cuatro datos a mano, que es exactamente lo que pasaba
 * antes de que esto existiera. Un decodificador de refuerzo que rompe la carga
 * sería peor que no tenerlo.
 */
export async function buscarQrConZxing(
  px: PixelesDe,
  lectorDado?: Lector
): Promise<string[]> {
  let lector: Lector;
  try {
    lector = lectorDado ?? (await prepararElLector());
  } catch {
    return [];
  }

  const completo = await recortar(lector, px, 0, 0, px.width, px.height);
  if (completo) return [completo];

  const encontrados: string[] = [];
  for (const r of rincones(px.width, px.height)) {
    const texto = await recortar(lector, px, r.x, r.y, r.w, r.h);
    if (texto && !encontrados.includes(texto)) encontrados.push(texto);
  }

  return encontrados;
}
