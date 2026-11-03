import { libroXlsx, type HojaAEscribir } from "./excel";
import { cabeceraDeDescarga } from "./descarga";

/**
 * Las descargas .xlsx del sistema.
 *
 * Desde el 03/10/2026 el archivo lo arma `exceljs` y no `xlsx` (SheetJS), que
 * tenía dos vulnerabilidades altas sin arreglo posible. El porqué completo y lo
 * que se midió está en `lib/core/excel.ts`.
 *
 * **Las dos funciones son `async`.** Es lo único que cambió para quien las usa:
 * `exceljs` escribe asincrónico. Las nueve rutas que las llaman ya eran `async`,
 * así que alcanzó con un `await`.
 */

/**
 * El `Content-Disposition` sale de `cabeceraDeDescarga` desde el 03/11/2026, y
 * no de un `filename="…"` armado acá.
 *
 * Las ocho descargas que ya existían llevan nombres ASCII, así que para ellas
 * no cambia nada. La novena —las marcaciones de un empleado— lleva el apellido
 * adentro del nombre del archivo, y las cabeceras HTTP son latin-1: un
 * `PÉREZ` en el `filename=` común llega mojibake o hace que el runtime rechace
 * la respuesta entera. El porqué completo está en `lib/core/descarga.ts`.
 */
function respuestaDeDescarga(filename: string, buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": cabeceraDeDescarga(filename),
    },
  });
}

/** Arma un .xlsx a partir de filas (array de arrays) y lo devuelve como Response de descarga. */
export async function xlsxResponse(
  filename: string,
  sheetName: string,
  rows: unknown[][]
): Promise<Response> {
  return respuestaDeDescarga(filename, await libroXlsx([{ nombre: sheetName, filas: rows }]));
}

/**
 * Igual que `xlsxResponse` pero con una hoja por entrada de `sheets` (ej. una
 * por día de la semana).
 *
 * `anchos` es opcional y va en caracteres, una entrada por columna: sin eso una
 * descripción larga se ve como `#####` hasta que quien abre el archivo arrastra
 * la columna a mano.
 */
export async function xlsxMultiSheetResponse(
  filename: string,
  sheets: { name: string; rows: unknown[][]; anchos?: number[] }[]
): Promise<Response> {
  const hojas: HojaAEscribir[] = sheets.map(({ name, rows, anchos }) => ({
    nombre: name,
    filas: rows,
    anchos,
  }));
  return respuestaDeDescarga(filename, await libroXlsx(hojas));
}
