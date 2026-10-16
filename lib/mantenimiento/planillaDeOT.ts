/**
 * Escribir en la fila que una OT tiene en la planilla.
 *
 * Salió de `app/api/mantenimiento/ordenes/route.ts`, donde era una función
 * privada, cuando las notas necesitaron escribir la columna X por el mismo
 * camino. Vive acá para que la guarda de abajo sea una sola: dos copias de
 * "fijate que la fila siga siendo la de esta OT" es cómo una se queda sin el
 * arreglo de la otra.
 *
 * No se prueba con vitest —habla con Google— pero lo que decide sí: qué celdas
 * escribir sale de `celdasParaRegistrar` y de `celdaDeObservacionPrevia`, que
 * tienen sus tests.
 */

import { leerValores, escribirCeldas } from "@/lib/core/sheets";

/** La OT, con lo justo para encontrar su fila y confirmar que es la de ella. */
export interface FilaDeOT {
  ot_number: number | null;
  sheets_row: number | null;
}

/**
 * Por qué este cambio no puede llegar a la planilla, o `null` si puede.
 *
 * EL 16/10/2026, dos veces el mismo silencio. La OT 2796 se creó desde la app
 * y se registró el trabajo; nada llegó a la planilla y la pantalla no dijo una
 * palabra, porque faltaba `sheets_row` y eso devolvía `null` — **el mismo
 * valor que "salió bien"**. Horas después volvió a morder al repararla a mano:
 * un script sin `GOOGLE_SHEETS_OT_ID` leyó ese `null` como éxito y reportó
 * cinco celdas escritas que nunca se escribieron.
 *
 * Un diagnóstico que no se distingue de otro no es un diagnóstico; uno que no
 * se distingue del éxito es peor. Las dos razones se devuelven juntas: saber
 * que falta la variable y descubrir recién después que además falta la fila es
 * la misma pérdida de tiempo, dos veces.
 *
 * `sheets_row` en null es el estado normal de una OT recién creada desde la
 * app —la fila del master la pone la sincronización, porque la fila en la hoja
 * de respuestas no es la del master—, así que esto no es un error del sistema:
 * es información para quien acaba de hacer el cambio.
 */
export function porQueNoLlegaALaPlanilla(
  planilla: string,
  orden: FilaDeOT
): string | null {
  const faltan: string[] = [];

  if (!planilla) {
    faltan.push("falta configurar GOOGLE_SHEETS_OT_ID");
  }
  // Cero no es una fila: las planillas empiezan en 1.
  if (!orden.sheets_row || orden.sheets_row < 1) {
    faltan.push(
      "la OT todavía no tiene fila en la planilla — se creó desde el sistema y hay que sincronizar las órdenes"
    );
  }

  if (faltan.length === 0) return null;
  return `El cambio quedó sólo en el sistema: ${faltan.join(" y ")}.`;
}

/**
 * Escribe celdas en la fila de la OT. Devuelve qué falló, o `null` si salió.
 *
 * Best-effort a propósito: la app ya guardó, y que Google esté caído o que la
 * planilla no esté compartida como editor no puede tirar abajo lo que se
 * registró. El problema se devuelve para que la pantalla lo muestre — un fallo
 * de escritura nunca es un `console.warn`.
 *
 * Antes de escribir se comprueba que la fila **siga siendo la de esta OT**: el
 * número de fila que guardamos se corre si alguien inserta una fila arriba, y
 * escribir a ciegas pisaría el trabajo de otro.
 */
export async function escribirEnLaFilaDeLaOT(
  orden: FilaDeOT,
  celdas: { columna: number; valor: string }[]
): Promise<string | null> {
  if (celdas.length === 0) return null;

  const planilla = process.env.GOOGLE_SHEETS_OT_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";

  // Y no `return null`, que es como esto se callaba.
  const noSePuede = porQueNoLlegaALaPlanilla(planilla, orden);
  if (noSePuede) return noSePuede;

  try {
    const fila = (await leerValores(
      planilla, `${pestana}!A${orden.sheets_row}:A${orden.sheets_row}`, { sinFormato: true }
    ))[0] ?? [];

    if (Number(fila[0]) !== orden.ot_number) {
      return "La fila de la planilla ya no es la de esta OT — alguien la movió. " +
             "Sincronizá las órdenes y volvé a intentar.";
    }

    await escribirCeldas(
      planilla,
      celdas.map((c) => ({ pestana, fila: orden.sheets_row!, columna: c.columna, valor: c.valor }))
    );
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
