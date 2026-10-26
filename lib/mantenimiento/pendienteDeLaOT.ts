/**
 * Qué hay que anotar cuando la exportación del registro de una OT no sale.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * `sheets_pendiente` no es sólo una cola de reintentos: es **lo único que evita
 * que la sincronización pise lo que cargó el sistema**. La importación de
 * `sincronizar.ts` saltea las órdenes que no se pudieron exportar —
 *
 *     if (sinExportar.has(orden.ot_number)) continue;
 *
 * — y ese conjunto sale de `exportarLoPendiente`, que mira exactamente las
 * órdenes con `sheets_pendiente` no nulo. O sea: **una orden que falló al
 * exportar y no quedó anotada no está en la cola y tampoco está protegida.**
 *
 * Eso es lo que pasó con las OT del 26/10/2026. La ruta de alta sí anotaba; la
 * de registrar el trabajo —el PATCH, que es por donde entran el estado, las
 * horas, el contratista y los operarios— escribía la planilla y, si fallaba,
 * devolvía el motivo a la pantalla y **nada más**. Como la fila del master
 * llega por `IMPORTRANGE` y tarda, fallar ahí es lo normal y no la excepción:
 * el encabezado del alta lo dejó medido —«este intento nunca salió ni una vez»,
 * las cinco órdenes fallaron a los 0,6 segundos—. Así que el registro quedaba
 * sólo en el sistema, sin cola que lo terminara y sin marca que lo defendiera,
 * y la sincronización siguiente —cada 3 a 5 horas— leía la `M` vacía y lo
 * borraba. Para quien carga es «se perdió otra vez lo que puse».
 *
 * ── LA REGLA, Y POR QUÉ NO SE ANOTA SIEMPRE ─────────────────────────────────
 *
 * La cola **no guarda el registro: lo vuelve a armar desde la fila** con
 * `loQueHayQueExportar`. Entonces anotar un fallo que esa función no sabe
 * reproducir es peor que no anotarlo: `exportarLoPendiente` lo encuentra, ve
 * que no hay nada que exportar, **limpia la marca** y sigue. Quedaría un
 * registro de que algo falló que se borra solo, y mientras tanto la orden
 * estuvo protegida por una razón que ya no existe.
 *
 * El caso concreto es un PATCH que sólo cambió las observaciones o la foto: no
 * tienen columna en `ordenes_trabajo`, así que no se pueden rearmar. Ahí el
 * error va a la pantalla, que es quien puede hacer algo, y no a la cola.
 *
 * ── Y POR QUÉ NO LIMPIA CUANDO SALE ─────────────────────────────────────────
 *
 * Porque el PATCH escribe **sólo las celdas que cambió**, y un pendiente
 * anterior puede ser por otras. Limpiarlo con una escritura parcial diría que
 * ya está todo exportado cuando no se sabe. Se lo deja para que lo resuelva
 * `exportarLoPendiente`, que sí escribe el registro completo; mientras tanto la
 * orden queda protegida de más, que es el lado barato de equivocarse.
 */

import { loQueHayQueExportar, type LoQueLaPlanillaNoSabe } from "./cierreDeOT";

/**
 * El motivo para `sheets_pendiente`, o `null` si no hay nada que encolar.
 *
 * `null` significa dos cosas distintas y las dos terminan igual: salió bien, o
 * falló algo que la cola no puede rehacer. En los dos casos no se escribe.
 *
 * @param orden  La fila **como quedó después del cambio**, no como estaba.
 * @param error  Lo que devolvió la escritura: `null` si salió.
 */
export function elPendienteDelIntento(
  orden: LoQueLaPlanillaNoSabe,
  error: string | null
): string | null {
  if (error === null) return null;
  return loQueHayQueExportar(orden) ? error : null;
}
