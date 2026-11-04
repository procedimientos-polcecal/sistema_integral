import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { esCandidataAlCalendario } from "./candidata";
import { mandarLaOTAlCalendario } from "./mandarLaOT";

/**
 * Lo que hace una OT recién nacida con el calendario: si le corresponde, entra
 * sola. Es **el único enganche**, y lo llaman las cuatro puertas que insertan
 * una orden de a una —el alta de `app/api/mantenimiento/ordenes`, los
 * periódicos de `generarPeriodicas`, y las dos generaciones de OT del cuaderno
 * y de los partes de contratista—.
 *
 * ── POR QUÉ ES UNA SOLA FUNCIÓN Y NO CUATRO ENGANCHES ───────────────────────
 *
 * Cada puerta podría haber decidido por su cuenta «¿esta orden va?». Eso son
 * cuatro copias de un criterio, y cuatro copias **divergen sin avisar**: una
 * puerta que mira la fecha de hoy con `>` y otra con `>=`, una que se acuerda
 * de las cerradas y otra que no. No falla nada ni se ve en ninguna pantalla;
 * simplemente una OT entra al calendario por una puerta y no por la otra, y se
 * descubre cuando alguien pregunta por qué falta un evento. Acá el criterio
 * vive en `esCandidataAlCalendario` y el envío en `mandarLaOTAlCalendario`, y
 * las puertas no deciden nada: llaman a esto y muestran lo que devuelve.
 *
 * Quedan afuera a propósito dos cosas. La sincronización del formulario es la
 * quinta puerta y **no lleva este enganche**: hace un `upsert` de la planilla
 * entera y no distingue un alta de una actualización, y además tiene que cubrir
 * la fecha que se edita después; eso lo resuelve el barrido, con las mismas
 * reglas. Y los avisos que no son OT no pasan por acá.
 *
 * ── EL EVENTO ES EL ESPEJO; LA ORDEN ES EL DATO ─────────────────────────────
 *
 * **Un fallo al crear el evento nunca puede fallar la OT.** Esto corre
 * **después** de que la orden está guardada —en la base y, donde manda, en la
 * planilla— y **nunca dentro de su transacción**: si dependiera de ella, una
 * caída de Google o un calendario sin dueño se llevaría puesta una orden que ya
 * existe donde manda, y quien la cargó vería un error sobre algo que sí salió.
 *
 * Por eso **no lanza jamás**: atrapa todo y devuelve **una frase** para que la
 * puerta la muestre —en `app/api/mantenimiento/ordenes` se suma a la respuesta;
 * en las otras tres, al informe que ya devuelven— o `null` cuando no hay nada
 * que decir. Callar un fallo sería peor: un evento que no se creó y que nadie
 * sabe que no se creó es una OT que el taller no ve en su calendario.
 *
 * `null` quiere decir dos cosas distintas y las dos son «nada que avisar»: que
 * la orden **no corresponde** (cerrada, sin fecha o con fecha que ya pasó: es
 * lo normal, y la inmensa mayoría) o que **entró sin novedad**. Todo lo demás
 * —un error, un evento que quedó pendiente en Google, el tope de un día
 * completo— sale como frase.
 *
 * ── LO AUTOMÁTICO NUNCA PISA ────────────────────────────────────────────────
 *
 * Se manda con `turno: null` (el horario lo calcula el apilado), sin invitados
 * extra y con `pisar: false`: si una persona movió o borró el evento en Google,
 * esto no lo vuelve a escribir. Pisarlo es una decisión explícita de alguien.
 */
export async function alNacerLaOT(
  admin: SupabaseClient,
  ordenId: string,
  ahora: Date = new Date()
): Promise<string | null> {
  let numero: number | string = ordenId;
  try {
    const { data: orden, error } = await admin
      .from("ordenes_trabajo")
      // La cadena va literal y en una sola pieza: partida con `+` pierde la
      // inferencia de tipos de Supabase.
      .select("ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_cierre, estado")
      .eq("id", ordenId)
      .maybeSingle();
    if (error) {
      return `La OT se guardó, pero no se pudo leer para mandarla al calendario: ${error.message}`;
    }
    if (!orden) {
      return "La OT se guardó, pero no se encontró para mandarla al calendario.";
    }
    numero = orden.ot_number ?? ordenId;

    // Lo normal: no corresponde y no hay nada que decir. Decide la misma
    // función que decide el barrido; `mandarLaOTAlCalendario` la vuelve a
    // aplicar adentro, pero sin esto un «no corresponde» saldría de allá como
    // un 400 indistinguible de un fallo de verdad.
    if (!esCandidataAlCalendario(orden, hoyEnArgentina(ahora)).ok) return null;

    const r = await mandarLaOTAlCalendario(
      admin, ordenId, { turno: null, invitadosExtra: [], pisar: false }, ahora
    );
    if (!r.ok) {
      return `La OT ${numero} se guardó, pero no entró al calendario: ${r.error}`;
    }
    if (r.advertencias.length > 0) {
      return `La OT ${numero} entró al calendario, pero: ${r.advertencias.join(" ")}`;
    }
    return null;
  } catch (e) {
    return `La OT ${numero} se guardó, pero no entró al calendario: ${e instanceof Error ? e.message : String(e)}`;
  }
}
