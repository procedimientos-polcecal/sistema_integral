import { conMargenBlanco, rincones, type PixelesDe, type Pixeles } from "./escaneoQr";

/**
 * Segunda opinión sobre el QR, con el ZXing de verdad compilado a WebAssembly.
 *
 * ## Por qué hace falta un segundo decodificador
 *
 * De las 139 facturas de septiembre de 2026, **unas cuantas no las decodifica
 * jsQR aunque se vean impecables** —DON ALFREDO, RUBIALES, ERGUY—. Se probó a
 * 7000 px, con umbral duro y con 274 ventanas: no era resolución, era el
 * decodificador. jsQR es un port en JavaScript y su corrección de errores se
 * rinde antes que la implementación original.
 *
 * Medido sobre la página de DON ALFREDO, dibujada igual que en producción:
 * **jsQR no la lee a ninguna escala; zxing la lee entera, de una, en 53 ms a
 * 1600 px y 75 ms a 2600**. Comprobado en un navegador de verdad, no sólo en
 * Node — que es donde se cayó el intento anterior de leer las imágenes
 * embebidas.
 *
 * ## Por qué no reemplaza a jsQR
 *
 * Porque jsQR ya resuelve 110 de 139 y **no cuesta una descarga**. El wasm son
 * 950 KB: se baja sólo cuando jsQR falló, o sea en las facturas que hoy se
 * tipean a mano. Quien carga una factura normal no paga nada.
 *
 * Por eso el orden es jsQR primero y esto después, y por eso el módulo se
 * importa con `import()` dinámico: si nunca se lo llama, no entra al bundle que
 * baja el navegador.
 *
 * ## Lo que sigue sin leerse
 *
 * El QR de TODO RULEMAN tampoco, y zxing falla igual que jsQR. Ampliando el
 * recorte se ve por qué: es un QR de versión muy alta —más de cien módulos de
 * lado— impreso en dos centímetros, así que en una hoja dibujada a 1600 px no
 * llega a dos píxeles por módulo. Eso no lo arregla un decodificador mejor.
 *
 * Lo arreglaría dibujar **esa zona** mucho más grande, y eso **no se pudo
 * comprobar**: de esa factura quedó un PNG de 1400 px y no el PDF, así que
 * reescalarlo no agrega información que no esté. Queda pendiente con el archivo
 * original a mano.
 */

/** El wasm se sirve como archivo estático, igual que el worker de pdf.js. */
const RUTA_DEL_WASM = "/pdfjs/zxing_reader.wasm";

type Lector = (p: Pixeles) => Promise<string | null>;

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

    return async (p: Pixeles) => {
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
          // `conMargenBlanco` arma un objeto plano, no un `ImageData` del
          // navegador, así que el espacio de color hay que declararlo. Es el
          // que tiene un canvas por defecto.
          colorSpace: "srgb",
        } satisfies ImageData,
        {
          formats: ["QRCode"],
          // `tryHarder` es justamente lo que jsQR no hace; `tryInvert` cubre los
          // comprobantes impresos en negativo y `tryRotate` los escaneos
          // torcidos. Sobre una hoja A4 esto son decenas de milisegundos.
          tryHarder: true,
          tryInvert: true,
          tryRotate: true,
        }
      );
      return encontrados.find((b) => b.text)?.text ?? null;
    };
  })();

  return preparando;
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
export async function buscarQrConZxing(px: PixelesDe): Promise<string[]> {
  let lector: Lector;
  try {
    lector = await prepararElLector();
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
