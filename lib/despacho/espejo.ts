import { agregarFila, crearPestana, escribirCeldas, leerValores, listarPestanas } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import { COLUMNAS, filaDeLaPlanilla, pestanaDelMes, RANGO_QUE_SE_ESCRIBE } from "./planilla";
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
 *
 * EL LIBRO TIENE UNA PESTAÑA POR MES (`ABRIL 2026` … `SEPTIEMBRE 2026`), y eso
 * decide tres cosas de acá:
 *
 *   - la pestaña sale del mes de la orden (`pestanaDelMes`), no de una variable;
 *   - la fila nueva se busca por la **columna B**, el Nº de orden: hay renglones
 *     cuya celda de fecha tiene el dato pero un formato que lo muestra vacío, y
 *     `agregarFila` lee el texto formateado, así que por la A creería que la hoja
 *     termina antes y los pisaría;
 *   - la pestaña del mes que arranca **se crea**, o el 1º de octubre el espejo
 *     dejaría de escribir y nadie se enteraría hasta fin de mes.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_DESPACHO_ID ?? "";

/**
 * La columna que dice dónde termina lo cargado: `B`, el Nº de orden.
 *
 * Nunca falta: 0 de 1.714 renglones sin Nº de orden, medido contra el libro. La
 * A, en cambio, se lee vacía en los renglones donde el formato de la celda
 * esconde la fecha, y buscar por ahí devolvería una fila ya escrita.
 */
const COLUMNA_QUE_MANDA = "B";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila quedó, para poder reescribirla al corregir. */
  fila?: number;
  /** En qué pestaña. Sale del mes de la orden; se devuelve para poder decirlo. */
  pestana?: string;
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
 * planilla diciendo lo de antes. Se escribe A:I y **no se tocan J ni K**: en
 * abril, mayo, junio y julio son las fórmulas `=F2-E2` y `=H2-G2`, y pisarlas
 * con un número las convertiría en dato muerto. (En agosto y septiembre están
 * vacías porque alguien no las arrastró — eso se arregla en la planilla, no
 * desde acá.)
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

  const pestana = pestanaDelMes(orden.fecha);
  if (!pestana) {
    return { ok: false, error: `La fecha de la orden (${orden.fecha}) no dice de qué mes es.` };
  }

  const valores = filaDeLaPlanilla(orden, clasificacion);

  try {
    if (orden.sheets_fila) {
      const primera = RANGO_QUE_SE_ESCRIBE.primera.charCodeAt(0) - 65;
      await escribirCeldas(
        PLANILLA(),
        valores.map((valor, i) => ({
          pestana,
          columna: primera + i,
          fila: orden.sheets_fila as number,
          valor,
        }))
      );
      return { ok: true, fila: orden.sheets_fila, pestana };
    }

    await asegurarLaPestana(pestana);
    const fila = await agregarFila(PLANILLA(), pestana, valores, COLUMNA_QUE_MANDA);
    return { ok: true, fila, pestana };
  } catch (e) {
    // El mensaje ya viene de `mensajeDeGoogle`: dice el código de Google, la
    // cuenta de servicio y qué se estaba haciendo. No se lo vuelve a envolver.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Que la pestaña del mes exista, creándola si es el primer día del mes nuevo.
 *
 * Los encabezados se copian de la pestaña que ya está, y no de `COLUMNAS`:
 * el libro los escribe distinto en cada mes —la columna de fecha se llama
 * `Fecha`, `Fecha Orden` y `Fecha Orden de carga` según la pestaña, y varios
 * tienen espacios de más— y una hoja nueva con títulos "prolijos" desalinearía
 * la serie para quien la lee. Si no hay ninguna de dónde copiar, se usan los
 * canónicos.
 */
async function asegurarLaPestana(pestana: string): Promise<void> {
  const pestanas = await listarPestanas(PLANILLA());
  if (pestanas.includes(pestana)) return;

  let encabezados: string[] = [...COLUMNAS];
  const anterior = pestanas[pestanas.length - 1];
  if (anterior) {
    const primera = (await leerValores(PLANILLA(), `${anterior}!1:1`))[0];
    if (primera && primera.length > 0) encabezados = primera;
  }

  await crearPestana(PLANILLA(), pestana, encabezados);
}
