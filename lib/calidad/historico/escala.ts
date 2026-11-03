/**
 * En qué escala está escrito un número del histórico del laboratorio.
 *
 * El 02/06/2026 Calidad cambió de planilla y con ella la forma de anotar: los
 * retenidos y acumulados pasaron de fracción (0,19) a porcentaje (19).
 *
 * **Esto no convierte nada.** Decide una etiqueta; el valor se guarda tal como
 * está escrito. El porqué está en el spec y vale repetirlo acá: la comprobación
 * que justificaría una conversión —el acumulado tiene que dar la suma de sus
 * retenidos— necesita dos retenidos en la misma fila, y antes del corte casi no
 * se medían. De 362 filas anteriores al cambio, la aritmética alcanza a 27.
 * Una etiqueta equivocada se corrige con un `update`; un dato convertido mal, no.
 */

export type Escala = "fraccion" | "porcentaje" | "absoluto";

/** El día que Calidad cambió de planilla. Confirmado por quien la lleva. */
export const CORTE_DE_PLANILLA = "2026-06-02";

/**
 * La escala de una columna **en una época**, decidida con sus propios datos.
 *
 * Se la pregunta dos veces por columna: una con los valores anteriores al corte
 * y otra con los posteriores. Que la columna haya nacido después del cambio de
 * planilla **no alcanza** para darla por porcentaje: `Despachos cal
 * fillerizada` arranca el 08/07/2026 y aun así escribe `Cal (%) = 0,81`, que
 * son 81%. La época no decide la escala; la deciden los valores de esa época.
 *
 * El ámbito es **la columna de una hoja**, nunca cruzando hojas.
 *
 * `valores` son los no nulos y distintos de cero de esa columna en esa época.
 * Vacío significa que no hay evidencia, y sin evidencia no se asume fracción:
 * asumirla es lo que multiplica por cien.
 */
export function escalaDeLaEpoca(etiqueta: string, valores: number[]): Escala {
  // La humedad fue fracción de punta a punta del archivo: no entra en la regla.
  if (/humedad/i.test(etiqueta)) return "fraccion";

  // Sin `%` en el encabezado no es un porcentaje: g/l, toneladas, gramos.
  if (!etiqueta.includes("%")) return "absoluto";

  // Sin evidencia no se asume fracción: asumirla es lo que multiplica por cien.
  if (valores.length === 0) return "porcentaje";

  // `< 1` y no `<= 1`: un 1 exacto es ambiguo —puede ser el 100% de una
  // fracción o un 1%— y ante la duda no se la trata como fracción, que es la
  // lectura que multiplicaría por cien.
  return valores.every((v) => v < 1) ? "fraccion" : "porcentaje";
}

/**
 * La escala de un valor concreto, a partir de la de su época.
 *
 * **La humedad no cambió nunca.** El cambio de planilla movió los
 * retenidos y los acumulados; la humedad siguió escribiéndose como fracción
 * —0,0102 el 06/10/2026—. Sin esta excepción, 251 humedades posteriores a junio
 * quedan etiquetadas como porcentaje y un 0,0102 se lee como 0,01% en vez de
 * 1,02%. Lo encontró la comparación contra el archivo real.
 *
 * `etiqueta` es opcional porque la regla sólo necesita distinguir la humedad;
 * sin ella, el corte se aplica como a cualquier otra columna.
 */
export function escalaDelValor(
  escalaDeColumna: Escala,
  fecha: string,
  etiqueta?: string
): Escala {
  if (etiqueta && /humedad/i.test(etiqueta)) return "fraccion";
  return escalaDeColumna;
}
