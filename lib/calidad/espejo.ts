import { agregarFila, escribirCeldas } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import {
  COLUMNA_QUE_MANDA,
  PESTANA,
  filaDeLaPlanilla,
  type CeldaDePlanilla,
  type ContextoDeLaFila,
  type MovimientoParaLaPlanilla,
} from "./planilla";

/**
 * Escribir en la planilla de stock el movimiento que se acaba de cargar.
 *
 * Acá manda el sistema, como en Producción y en las órdenes de carga: la
 * planilla queda como el lugar donde miran los que no entran al SdG, y su
 * llenado a mano desaparece. Hoy son 1.043 renglones transcritos de algo que ya
 * estaba en otras dos partes.
 *
 * **No lanza: devuelve qué pasó.** Quien lo llama anota el pendiente con lo que
 * dijo Google **sin traducir** y se lo dice a quien guardó. Un fallo de
 * escritura no es un `console.warn`: eso costó una tarde entera en Compras.
 *
 * El libro tiene una sola pestaña de datos, así que no hay pestaña que crear.
 * La columna que manda es la `A` (`CODIGO`) y **no la `B`**: la `B` tiene un
 * `VLOOKUP` precargado cientos de filas más abajo de lo cargado, así que por ahí
 * la "última fila con algo" sale muy pasada y la escritura dejaría un hueco.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_STOCK_CARBONILLA_ID ?? "";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila quedó, para poder reescribirla al corregir. */
  fila?: number;
  /** Qué dijo Google, sin traducir. */
  error?: string;
}

/** Si el espejo puede intentar escribir. Sin esto el movimiento queda pendiente, no falla. */
export function hayEspejoDeStock(): boolean {
  return hayCredencialesGoogle() && Boolean(PLANILLA());
}

/**
 * Agrega la fila si es nueva, o reescribe la que ya tiene.
 *
 * **Se escriben las diez columnas en los dos caminos, fórmulas incluidas.** La
 * excepción a "no pises una fórmula" está justificada en `planilla.ts`: la de
 * `RESIDUAL` está cableada a un solo proveedor y ninguna sabe representar un
 * ajuste en más. Sostener la fórmula viva sería sostener dos saldos que
 * discrepan.
 */
export async function escribirMovimiento(
  movimiento: MovimientoParaLaPlanilla,
  contexto: ContextoDeLaFila,
  filaExistente: number | null
): Promise<ResultadoEspejo> {
  if (!hayEspejoDeStock()) {
    return {
      ok: false,
      error:
        "Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID o las credenciales de Google, así que no se escribió en la planilla.",
    };
  }

  // Armar la fila puede fallar por datos —una entrada sin carbonillero, una
  // fecha imposible— y eso no es un error de Google: se informa igual, pero se
  // distingue por el texto.
  let celdas: CeldaDePlanilla[];
  try {
    celdas = filaDeLaPlanilla(movimiento, contexto);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    if (filaExistente === null) {
      const fila = await agregarFila(PLANILLA(), PESTANA, celdas, COLUMNA_QUE_MANDA);
      return { ok: true, fila };
    }

    await escribirCeldas(
      PLANILLA(),
      celdas.map((valor, columna) => ({ pestana: PESTANA, columna, fila: filaExistente, valor }))
    );
    return { ok: true, fila: filaExistente };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
