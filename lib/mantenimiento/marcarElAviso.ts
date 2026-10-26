import { createAdminClient } from "@/lib/supabase/admin";
import { escribirCeldas } from "@/lib/core/sheets";
import { COLUMNA_OT_ASIGNADA } from "@/lib/mantenimiento/avisos";

/**
 * Dejar un aviso apuntando a una orden de trabajo, de los dos lados.
 *
 * ── POR QUÉ ESTÁ ACÁ Y NO EN UNA RUTA ───────────────────────────────────────
 *
 * Hay **dos caminos** por los que un aviso termina con OT, y desde el
 * 23/10/2026 son dos: generar la orden desde el aviso, y enlazarle una que ya
 * existe porque el encargado del área se adelantó. Los dos tienen que dejar
 * exactamente la misma marca —`work_order_id` y `ot_asignada` en la tabla, y
 * el número en la columna `OT ASIGNADA` de la planilla—, porque de esas tres
 * cosas salen `finalDelAviso`, la lista de «sin orden de trabajo» y lo que ve
 * quien no entra al sistema.
 *
 * Escrita dos veces, se separan: una escribe la columna y la otra se olvida, y
 * el aviso queda con OT para el sistema y pendiente para la planilla, o al
 * revés. Es la misma familia de error que `otDesdeAviso.ts` documenta en su
 * encabezado —dos mitades en archivos distintos, ninguna sabe de la otra— y
 * acá se evita de la única forma que funciona: hay una sola.
 *
 * ── LA PLANILLA NO PUEDE DESHACER LO QUE LA BASE YA GUARDÓ ──────────────────
 *
 * Primero la base y después la planilla, como en `desestimar`. Si Google no
 * contesta, el enlace igual quedó hecho y se devuelve **lo que Google dijo,
 * sin traducir**, para que quien hizo la acción se entere de que la planilla
 * no lo sabe. Nunca un `console.warn`.
 *
 * ── Y ESO ES TODO LO QUE HAY: NO HAY COLA. HUECO CONOCIDO ───────────────────
 *
 * Anotado el 26/10/2026, revisando qué rutas tenían el agujero del PATCH de
 * OT. Ésta lo tiene a medias, y conviene saber exactamente hasta dónde.
 *
 * `filaDeAviso` **vuelve a leer la columna `OT ASIGNADA`**, así que la próxima
 * sincronización pisa `ot_asignada` con la celda vacía. Lo que la salva es que
 * `work_order_id` **no se importa** y es el que manda en `finalDelAviso`: la
 * decisión no se pierde y el aviso sigue figurando con orden en el SdG. Lo que
 * sí se pierde para siempre es que la planilla se entere — y la planilla es lo
 * que mira quien no entra al sistema.
 *
 * Encolarlo pide tres cosas que no son una línea: una columna de pendiente en
 * `avisos` (hoy no la tiene, comprobado contra la base), un drenaje en
 * `sincronizarAvisos` —que hoy sólo lee— y decidir qué hace ese drenaje con el
 * caso de **vaciar** la celda, que es el que usa `enlazar` al desenlazar.
 * Mientras tanto queda declarado en el registro de
 * `scripts/revisar-exportaciones.mjs`, que lo lista en cada corrida.
 *
 * El tamaño, medido el 26/10/2026: 196 avisos, 186 con `ot_asignada`, y
 * **ninguno** con `work_order_id` y la columna vacía — o sea que hasta hoy no
 * se perdió ninguno.
 *
 * ── LAS DOS FALLAS NO SON LA MISMA, Y POR ESO VUELVEN SEPARADAS ─────────────
 *
 * Que no se haya podido guardar la marca y que se haya guardado pero la
 * planilla no lo sepa son estados distintos: en el primero el aviso **sigue
 * pendiente** y hay que volver a intentar, en el segundo el trabajo ya está
 * enlazado y lo que falta se arregla solo en la próxima sincronización.
 * Devolver un `string | null` para los dos —como estaba hasta el 23/10/2026,
 * cuando esto vivía dentro de la ruta de órdenes— obliga a quien llama a
 * adivinar cuál de los dos pasó, y lo normal es que llame al primero «no se
 * pudo escribir en la planilla» y dé por hecho un enlace que no existe.
 *
 * ── LOS DOS CAMINOS DEJAN LO MISMO, Y POR ESO HAY QUE DECIR CUÁL FUE ───────
 *
 * Que dejen exactamente la misma marca es lo que esta función viene a
 * garantizar, y desde el 26/10/2026 es también lo que impedía deshacerlos:
 * desenlazar una orden que existía antes devuelve el estado anterior, y
 * desenlazar una que el sistema creó desde el aviso deja una OT que nadie
 * reclama. En la tabla eran indistinguibles.
 *
 * Por eso `enlazadaPor` es **explícito y opcional**, y no algo que esta
 * función deduzca: sólo lo pasa la ruta de enlazar, que es la única que sabe
 * que la orden ya estaba. El alta de una OT no lo pasa, y así el valor por
 * defecto —null— es el que no habilita a borrar nada. El porqué completo está
 * en el encabezado de `lib/mantenimiento/enlazarOtAlAviso.ts`.
 */
export interface MarcaDelAviso {
  /** No se pudo guardar: el aviso **no** quedó enlazado. */
  error: string | null;
  /** Quedó enlazado en el sistema, pero la planilla no se enteró. */
  planillaError: string | null;
}

export async function marcarElAviso(
  admin: ReturnType<typeof createAdminClient>,
  avisoId: string,
  otId: string,
  otNumber: number,
  /** Quién enlazó una orden **que ya existía**. Sólo lo pasa `avisos/enlazar`. */
  enlazadaPor?: string | null
): Promise<MarcaDelAviso> {
  const { data: aviso, error } = await admin
    .from("avisos")
    .update({
      work_order_id: otId,
      ot_asignada: String(otNumber),
      ...(enlazadaPor
        ? { ot_enlazada_en: new Date().toISOString(), ot_enlazada_por: enlazadaPor }
        : {}),
    })
    .eq("id", avisoId)
    .select("sheets_row")
    .single();

  if (error) return { error: error.message, planillaError: null };

  const planilla = process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";
  if (!planilla || !aviso?.sheets_row) return { error: null, planillaError: null };

  try {
    await escribirCeldas(planilla, [{
      pestana,
      fila: aviso.sheets_row,
      columna: COLUMNA_OT_ASIGNADA,
      valor: String(otNumber),
    }]);
    return { error: null, planillaError: null };
  } catch (e) {
    return { error: null, planillaError: e instanceof Error ? e.message : String(e) };
  }
}
