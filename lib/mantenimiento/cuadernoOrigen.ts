/**
 * De dónde vino una carga del cuaderno: de fotos o de un Excel.
 *
 * **No hay una columna que lo diga, y es a propósito.** El Excel es una
 * alternativa a las fotos y no un modelo aparte: guarda su archivo en el mismo
 * bucket y en la misma tabla (`mant_cuadernos_fotos`) con `orden: 1`, así que
 * lo único que distingue una foto de un Excel es la extensión de la `ruta`.
 * Agregar una columna habría sido una migración que corre una persona, para
 * guardar un dato que la ruta ya trae.
 *
 * Vive **en su propio archivo** y no junto al intérprete del Excel porque la
 * pantalla lo importa: `cuadernoExcel.ts` arrastra `zod` (por el tope de
 * horas y la fecha de `cuadernoLectura`) y no hay razón para mandarlo al
 * navegador por una expresión regular.
 */

/** El tipo de medio de un `.xlsx`. Tiene que estar en `allowed_mime_types` del bucket. */
export const TIPO_DE_EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** ¿Esta ruta del bucket es el Excel de una carga y no la foto de una página? */
export function esRutaDeExcel(ruta: string): boolean {
  return /\.xlsx$/i.test(ruta);
}
