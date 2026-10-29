/**
 * Escribir en la fila que un aviso tiene en su planilla.
 *
 * Estaba copiada en tres lugares —`marcarElAviso`, el POST y el DELETE de
 * `avisos/desestimar`, el DELETE de `avisos/enlazar`— cada uno con su propio
 * `if (planilla && sheets_row)` y su propio `try`. Vive acá por lo mismo que
 * `planillaDeOT.ts` y `planillaDeOS.ts`: para que la guarda sea **una sola**.
 * Tres copias es cómo dos se quedan sin el arreglo de la tercera.
 *
 * No se prueba con vitest —habla con Google— pero lo que decide sí: qué celdas
 * escribir sale de `pendienteDelAviso.ts`, que tiene sus tests.
 */

import { escribirCeldas } from "@/lib/core/sheets";

/** El aviso, con lo justo para encontrar su fila. */
export interface FilaDelAviso {
  oa_number: string | null;
  sheets_row: number | null;
}

/**
 * Por qué este cambio no puede llegar a la planilla, o `null` si puede.
 *
 * **Existe para que «no se pudo» deje de parecerse a «salió bien».** Los tres
 * caminos de antes hacían `if (planilla && sheets_row) { ... }` y seguían de
 * largo cuando faltaba alguno: la escritura no pasaba y nadie se enteraba. Con
 * una cola detrás eso es peor que un cartel que falta, porque el llamador lee
 * «no hubo error» y **limpia el pendiente**. Es la misma trampa que
 * `porQueNoLlegaALaPlanilla` le sacó a las OT el 16/10/2026.
 *
 * El caso de `sheets_row` nulo no es teórico aunque hoy no haya ninguno
 * (202 avisos, todos con fila, medido el 29/10/2026): un aviso dado de alta en
 * la app existe en la base antes de que la sincronización le asigne su fila.
 */
export function porQueNoLlegaElAvisoALaPlanilla(
  planilla: string,
  aviso: FilaDelAviso
): string | null {
  if (!planilla) {
    return "El cambio quedó sólo en el sistema: falta configurar GOOGLE_SHEETS_AVISOS_ID.";
  }
  if (!aviso.sheets_row) {
    return (
      `El aviso ${aviso.oa_number ?? "—"} todavía no tiene fila conocida en la planilla, ` +
      `así que el cambio quedó sólo en el sistema. Se reintenta en la próxima ` +
      `sincronización, que es la que le asigna la fila.`
    );
  }
  return null;
}

/**
 * Escribe celdas en la fila del aviso. Devuelve qué falló, o `null` si salió.
 *
 * Best-effort a propósito: la app ya guardó, y que Google esté caído o que la
 * planilla no esté compartida como editor no puede deshacer la decisión. El
 * problema se devuelve para que la ruta lo anote en `sheets_pendiente` y la
 * pantalla lo muestre — un fallo de escritura nunca es un `console.warn`.
 *
 * **No se busca la fila por el número de aviso**, a diferencia de las OT. Acá
 * `sheets_row` es confiable: esta planilla es la hoja de respuestas del
 * formulario, no un master armado con `IMPORTRANGE` que se reordena, así que
 * las filas no se corren. Si algún día se ordena, esto hay que cambiarlo igual
 * que se cambió `filaDeLaOTenElMaster` el 16/10/2026.
 */
export async function escribirEnLaFilaDelAviso(
  aviso: FilaDelAviso,
  celdas: { columna: number; valor: string }[]
): Promise<string | null> {
  if (celdas.length === 0) return null;

  const planilla = process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";

  // Y no `return null`, que es como esto se callaba.
  const noSePuede = porQueNoLlegaElAvisoALaPlanilla(planilla, aviso);
  if (noSePuede) return noSePuede;

  try {
    await escribirCeldas(
      planilla,
      celdas.map((c) => ({ pestana, fila: aviso.sheets_row as number, columna: c.columna, valor: c.valor }))
    );
    return null;
  } catch (e) {
    // El mensaje ya viene de `mensajeDeGoogle`: dice el código, la cuenta de
    // servicio y qué se estaba haciendo. No se lo vuelve a envolver.
    return e instanceof Error ? e.message : String(e);
  }
}
