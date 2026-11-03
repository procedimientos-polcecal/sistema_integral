import { createAdminClient } from "@/lib/supabase/admin";
import { COLUMNA_OT_ASIGNADA } from "@/lib/mantenimiento/avisos";
import { escribirEnLaFilaDelAviso } from "@/lib/mantenimiento/planillaDelAviso";
import { camposDelPendiente, elIntentoDelAviso } from "@/lib/mantenimiento/pendienteDelAviso";

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
 * ── Y SI NO LLEGA, QUEDA ANOTADO ────────────────────────────────────────────
 *
 * Desde el 29/10/2026. Antes el fallo iba sólo a la pantalla, y eso era un
 * agujero igual al que tuvo el PATCH de las OT: `filaDeAviso` **vuelve a leer
 * la columna `OT ASIGNADA`**, así que la sincronización siguiente pisaba
 * `ot_asignada` con la celda vacía y la planilla no se enteraba nunca.
 *
 * Lo que lo hacía menos grave que en las OT —y conviene saberlo— es que
 * `work_order_id` **no se importa** y es el que manda en `finalDelAviso`: la
 * decisión nunca se perdió, el aviso siguió figurando con orden en el SdG. Lo
 * que se perdía era que lo supiera quien mira la planilla y no entra al
 * sistema. Medido el 26/10/2026, antes del arreglo: ningún aviso tenía
 * `work_order_id` con la columna vacía.
 *
 * El pendiente se anota **por campo** (`sheets_pendiente_campos`), y ese
 * detalle no es menor: el porqué está en el encabezado de
 * `lib/mantenimiento/pendienteDelAviso.ts`.
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
    .select("oa_number, sheets_row, sheets_pendiente_campos")
    .single();

  if (error) return { error: error.message, planillaError: null };

  const planillaError = await escribirEnLaFilaDelAviso(aviso, [
    { columna: COLUMNA_OT_ASIGNADA, valor: String(otNumber) },
  ]);

  // Y queda anotado. No es sólo una cola de reintentos: es lo único que evita
  // que `sincronizarAvisos` vuelva a leer `OT ASIGNADA` y pise el enlace con la
  // celda vacía. Qué se anota lo decide `elIntentoDelAviso`, con sus tests.
  await admin
    .from("avisos")
    .update(
      elIntentoDelAviso(
        planillaError,
        ["ot_asignada"],
        camposDelPendiente(aviso.sheets_pendiente_campos)
      )
    )
    .eq("id", avisoId);

  return { error: null, planillaError };
}
