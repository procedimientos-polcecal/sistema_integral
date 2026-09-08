import { agregarFila, escribirCeldas } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import { filaDeLaPlanilla, RANGO_QUE_SE_ESCRIBE } from "./planilla";
import type { Clasificacion, OrdenDeCarga } from "./types";

/**
 * Escribir en la planilla la orden que se acaba de cerrar.
 *
 * Acá manda el sistema, no la planilla: es la diferencia con Compras e
 * Inventario y la misma dirección que Producción. La planilla queda como el
 * lugar donde miran los que no entran al sistema, y su llenado a mano —a la
 * mañana siguiente, con las órdenes del día anterior— desaparece.
 *
 * **No lanza: devuelve qué pasó.** Quien lo llama anota el pendiente con lo que
 * dijo Google sin traducir y se lo dice a quien guardó. Un fallo de escritura no
 * es un `console.warn`: eso costó una tarde entera en Compras.
 *
 * **Se escribe al cerrar la orden**, no en cada botón: una escritura por orden y
 * no cuatro. Los cuatro horarios ya están cuando la orden se cierra, así que
 * escribir antes sería escribir una fila incompleta y volver a escribirla tres
 * veces.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_DESPACHO_ID ?? "";
const PESTANA = () => process.env.GOOGLE_SHEETS_DESPACHO_TAB ?? "Órdenes de Carga";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila quedó, para poder reescribirla al corregir. */
  fila?: number;
  /** Qué dijo Google, sin traducir. Un diagnóstico que no se distingue de otro no sirve. */
  error?: string;
}

/** Si el espejo puede intentar escribir. Sin esto la orden queda pendiente, no falla. */
export function hayEspejoDeDespacho(): boolean {
  return hayCredencialesGoogle() && Boolean(PLANILLA());
}

/**
 * Escribe la orden: agrega la fila si es nueva, o reescribe la que ya tiene.
 *
 * Reescribir es lo que hace que corregir un horario en el sistema no deje la
 * planilla diciendo lo de antes. Se escribe A:I y **no se tocan J ni K**, que
 * son las dos columnas calculadas: pisarlas con un número las convertiría en
 * dato y la planilla dejaría de calcular sola.
 */
export async function espejarOrden(
  orden: OrdenDeCarga,
  clasificacion: Clasificacion | null
): Promise<ResultadoEspejo> {
  if (!hayEspejoDeDespacho()) {
    return {
      ok: false,
      error:
        "Falta GOOGLE_SHEETS_DESPACHO_ID o la credencial de Google: la orden quedó sin escribir en la planilla.",
    };
  }

  const valores = filaDeLaPlanilla(orden, clasificacion);

  try {
    if (orden.sheets_fila) {
      const primera = RANGO_QUE_SE_ESCRIBE.primera.charCodeAt(0) - 65;
      await escribirCeldas(
        PLANILLA(),
        valores.map((valor, i) => ({
          pestana: PESTANA(),
          columna: primera + i,
          fila: orden.sheets_fila as number,
          valor,
        }))
      );
      return { ok: true, fila: orden.sheets_fila };
    }

    const fila = await agregarFila(PLANILLA(), PESTANA(), valores);
    return { ok: true, fila };
  } catch (e) {
    // El mensaje ya viene de `mensajeDeGoogle`: dice el código de Google, la
    // cuenta de servicio y qué se estaba haciendo. No se lo vuelve a envolver.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
