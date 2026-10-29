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
import type { ValorDeCelda } from "@/lib/mantenimiento/ordenes";

/**
 * La OT, con lo justo para encontrar su fila.
 *
 * `sheets_row` ya no está: la fila se busca por el número. La columna sigue en
 * la base y la sigue llenando la sincronización, pero la escritura dejó de
 * apoyarse en ella.
 */
export interface FilaDeOT {
  ot_number: number | null;
}

/**
 * Por qué este cambio no puede llegar a la planilla, o `null` si puede.
 *
 * EL 16/10/2026, dos veces el mismo silencio. La OT 2796 se creó desde la app
 * y se registró el trabajo; nada llegó a la planilla y la pantalla no dijo una
 * palabra, porque devolvía `null` — **el mismo valor que "salió bien"**. Horas
 * después volvió a morder al repararla a mano: un script sin
 * `GOOGLE_SHEETS_OT_ID` leyó ese `null` como éxito y reportó cinco celdas
 * escritas que nunca se escribieron.
 *
 * Un diagnóstico que no se distingue de otro no es un diagnóstico; uno que no
 * se distingue del éxito es peor.
 *
 * Antes también miraba `sheets_row`. Dejó de hacerlo cuando la fila pasó a
 * buscarse: no tenerla guardada ya no impide nada.
 */
export function porQueNoLlegaALaPlanilla(planilla: string): string | null {
  if (planilla) return null;
  return "El cambio quedó sólo en el sistema: falta configurar GOOGLE_SHEETS_OT_ID.";
}

/**
 * En qué fila del master está una OT, buscándola por su número.
 *
 * **Se busca y no se calcula.** Mientras el master conservaba el orden de la
 * hoja de respuestas, la fila se podía deducir; desde que ordena por N° de OT
 * —16/10/2026— esa cuenta dejó de valer, y una cuenta que deja de valer **no
 * avisa**: sigue devolviendo un número plausible y la escritura se va a la fila
 * de otra orden. Es la misma lección que Compras escribió el 11/09/2026.
 *
 * Buscar hace además que **la búsqueda sea la verificación**: si la OT no está,
 * no se escribe. Y no estar es lo normal recién creada, porque el `IMPORTRANGE`
 * del master tarda — por eso devuelve `null` y no algo aproximado.
 *
 * Devuelve el número de fila como lo cuenta una planilla: la primera es la 1.
 */
export function filaDeLaOTenElMaster(
  columnaA: readonly (readonly unknown[])[],
  ot_number: number | null
): number | null {
  if (ot_number === null) return null;

  for (let i = 0; i < columnaA.length; i++) {
    if (Number(String(columnaA[i]?.[0] ?? "").trim()) === ot_number) return i + 1;
  }
  return null;
}

/**
 * Escribe celdas en la fila que la OT tiene en el master. Devuelve qué falló, o
 * `null` si salió.
 *
 * Best-effort a propósito: la app ya guardó, y que Google esté caído o que la
 * planilla no esté compartida como editor no puede tirar abajo lo que se
 * registró. El problema se devuelve para que la pantalla lo muestre — un fallo
 * de escritura nunca es un `console.warn`.
 *
 * La fila **se busca por el N° de OT** en vez de venir dada. Antes llegaba en
 * `sheets_row` y se comprobaba releyendo la columna A; buscar hace las dos
 * cosas de una, y sobre todo sobrevive a que el master ordene por número, que
 * es lo que hace que la posición de una fila ya no sea estable.
 */
export async function escribirEnLaFilaDeLaOT(
  orden: FilaDeOT,
  celdas: { columna: number; valor: ValorDeCelda }[]
): Promise<string | null> {
  if (celdas.length === 0) return null;

  const planilla = process.env.GOOGLE_SHEETS_OT_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";

  // Y no `return null`, que es como esto se callaba.
  const noSePuede = porQueNoLlegaALaPlanilla(planilla);
  if (noSePuede) return noSePuede;

  try {
    const columnaA = await leerValores(planilla, `${pestana}!A:A`, { sinFormato: true });
    const fila = filaDeLaOTenElMaster(columnaA, orden.ot_number);

    if (fila === null) {
      return `La OT ${orden.ot_number} todavía no está en la planilla —el master la ` +
             `recibe por IMPORTRANGE y tarda—, así que el cambio quedó sólo en el ` +
             `sistema. Probá de nuevo en un rato o sincronizá las órdenes.`;
    }

    // Acá —y sólo acá— se sabe en qué fila cae la escritura, así que es donde
    // se resuelve un valor que depende de ella: hoy, la fórmula del estado,
    // que nombra al J y al L de su propio renglón. Ver `ValorDeCelda`.
    await escribirCeldas(
      planilla,
      celdas.map((c) => ({
        pestana, fila, columna: c.columna,
        valor: typeof c.valor === "function" ? c.valor(fila) : c.valor,
      }))
    );
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
