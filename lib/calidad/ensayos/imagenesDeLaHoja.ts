import type { ImagenDeLaHoja } from "@/lib/core/excel";

/**
 * Lo que decide dónde y de qué tamaño va cada foto de gráfico dentro de la hoja
 * del Excel de la curva, y si el archivo que llegó es de verdad un PNG.
 *
 * Vive acá y no en la ruta porque **no es pegamento de I/O**: la lectura de la
 * cabecera es la única validación de seguridad de la descarga, y la colocación
 * decide qué se ve en el archivo. Las dos son puras y las dos se prueban.
 */

/** Los primeros ocho bytes de todo PNG. */
const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * El lado más largo que se acepta, en píxeles. Un gráfico de pantalla
 * rasterizado a `scale: 4` da unos 1.500 px; 8.000 deja de sobra y corta lo que
 * ya no es un gráfico: una cabecera que dice 1 × 4.000.000.000 pasa la firma y
 * deja un `.xlsx` corrupto, porque el alto escalado se sale de lo que Excel
 * admite.
 */
export const LADO_MAXIMO_PX = 8000;

/** Ancho al que se escala cada imagen en la hoja, en píxeles. */
export const ANCHO_EN_LA_HOJA = 640;

/** Alto de una fila de Excel por defecto, en píxeles. */
export const ALTO_DE_FILA = 20;

/**
 * Ancho y alto de un PNG, leídos de su cabecera IHDR (bytes 16 a 23).
 *
 * Devuelve `null` si el archivo no es un PNG, si está truncado, si su cabecera
 * no dice un tamaño o si ese tamaño es absurdo (cero, o más de
 * `LADO_MAXIMO_PX` de lado).
 */
export function medidasDelPng(bytes: Buffer): { ancho: number; alto: number } | null {
  if (bytes.length < 24) return null;
  if (!FIRMA_PNG.every((b, i) => bytes[i] === b)) return null;
  // Después de la firma viene siempre el trozo IHDR.
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const ancho = bytes.readUInt32BE(16);
  const alto = bytes.readUInt32BE(20);
  if (ancho === 0 || alto === 0) return null;
  if (ancho > LADO_MAXIMO_PX || alto > LADO_MAXIMO_PX) return null;
  return { ancho, alto };
}

/**
 * Pone las imágenes una debajo de la otra en la columna indicada: cada una a
 * `ANCHO_EN_LA_HOJA` de ancho, con el alto que le corresponde por su aspecto, y
 * una fila libre entre una y la siguiente.
 *
 * Todas llevan el mismo ancho a propósito: la resolución sale del rasterizado y
 * no de esta cuenta, así que subir la nitidez es subir el `scale` de la foto y
 * no tocar nada de acá.
 */
export function colocarImagenes(
  imagenes: { png: Buffer; ancho: number; alto: number }[],
  columna: number
): ImagenDeLaHoja[] {
  let fila = 0;
  return imagenes.map(({ png, ancho, alto }) => {
    const altoFinal = Math.round((alto * ANCHO_EN_LA_HOJA) / ancho);
    const colocada = { png, fila, columna, ancho: ANCHO_EN_LA_HOJA, alto: altoFinal };
    fila += Math.ceil(altoFinal / ALTO_DE_FILA) + 1;
    return colocada;
  });
}
