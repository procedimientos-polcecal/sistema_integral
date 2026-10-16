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
  if (!planilla || !orden.sheets_row) return null;

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
