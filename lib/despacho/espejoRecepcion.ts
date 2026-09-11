import { agregarFila, escribirCeldas } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import {
  COLUMNA_QUE_MANDA,
  PESTANA_DEL_DETALLE,
  celdasDeLaRecepcion,
  netoDeLaRecepcion,
  primerasCeldas,
} from "./recepcion";
import type { Recepcion } from "./types";

/**
 * Escribir en la planilla de carbonilla la recepción que se acaba de cerrar.
 *
 * Acá manda el sistema, como en Producción y en las órdenes de carga: la
 * planilla queda como el lugar donde miran los que no entran al SdG, y su
 * llenado a mano desaparece. Hoy son 567 renglones transcritos a mano de algo
 * que ya estaba en Odoo.
 *
 * **No lanza: devuelve qué pasó.** Quien lo llama anota el pendiente con lo que
 * dijo Google sin traducir y se lo dice a quien guardó. Un fallo de escritura no
 * es un `console.warn`: eso costó una tarde entera en Compras.
 *
 * EL LIBRO TIENE UNA SOLA PESTAÑA DE DATOS (`Detalle`) y no una por mes, así
 * que no hay pestaña que crear ni que despejar. La otra —`RESUMEN POR DIA `, con
 * el espacio al final— es fórmulas y no se toca nunca.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_CARBONILLA_ID ?? "";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila quedó, para poder reescribirla al corregir. */
  fila?: number;
  /** Qué dijo Google, sin traducir. */
  error?: string;
}

/** Si el espejo puede intentar escribir. Sin esto la recepción queda pendiente, no falla. */
export function hayEspejoDeCarbonilla(): boolean {
  return hayCredencialesGoogle() && Boolean(PLANILLA());
}

/**
 * Escribe la recepción: agrega la fila si es nueva, o reescribe la que ya tiene.
 *
 * **La `E` (`Total del Dia `) no se toca en ninguno de los dos caminos.** Al
 * agregar se mandan sólo las cuatro primeras columnas, y al corregir se escribe
 * celda por celda salteándola. Está vacía en los 567 renglones y el total vive
 * como fórmula en la otra pestaña: escribir ahí es lo que la convertiría en dato
 * muerto el día que alguien la arrastre.
 */
export async function espejarRecepcion(
  recepcion: Recepcion,
  nombreParaLaPlanilla: string
): Promise<ResultadoEspejo> {
  if (!hayEspejoDeCarbonilla()) {
    return {
      ok: false,
      error:
        "Falta GOOGLE_SHEETS_CARBONILLA_ID o la credencial de Google: la recepción quedó sin escribir en la planilla.",
    };
  }

  const celdas = celdasDeLaRecepcion({
    fecha: recepcion.fecha,
    proveedor: nombreParaLaPlanilla,
    toneladas: netoDeLaRecepcion(recepcion).toneladas,
    notas: recepcion.notas,
    odooNombre: recepcion.odoo_purchase_name,
    lugarDescarga: recepcion.lugar_descarga,
  });

  try {
    if (recepcion.sheets_fila) {
      await escribirCeldas(
        PLANILLA(),
        celdas.map((c) => ({
          pestana: PESTANA_DEL_DETALLE,
          columna: c.columna,
          fila: recepcion.sheets_fila as number,
          valor: c.valor,
        }))
      );
      return { ok: true, fila: recepcion.sheets_fila };
    }

    // Las cuatro primeras (`A:D`) definen dónde cae la fila; las dos últimas se
    // escriben después, por celda, para no pasar por encima de la `E`.
    const fila = await agregarFila(
      PLANILLA(),
      PESTANA_DEL_DETALLE,
      primerasCeldas(celdas),
      COLUMNA_QUE_MANDA
    );

    await escribirCeldas(
      PLANILLA(),
      celdas
        .filter((c) => c.columna > 4)
        .map((c) => ({ pestana: PESTANA_DEL_DETALLE, columna: c.columna, fila, valor: c.valor }))
    );

    return { ok: true, fila };
  } catch (e) {
    // El mensaje ya viene de `mensajeDeGoogle`: dice el código, la cuenta de
    // servicio y qué se estaba haciendo. No se lo vuelve a envolver.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
