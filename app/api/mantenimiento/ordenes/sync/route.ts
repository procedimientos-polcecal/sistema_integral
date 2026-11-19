import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { sincronizarOrdenes } from "@/lib/mantenimiento/sincronizar";

export const maxDuration = 300;

/**
 * Trae las órdenes de trabajo de su planilla, a pedido de alguien.
 *
 * El trabajo está en `lib/mantenimiento/sincronizar`: acá sólo se comprueba
 * quién lo pide. El reloj llama a la misma función sin pasar por acá.
 */
/**
 * El freno de mano del borrado, levantado a mano.
 *
 * Cuando la planilla dejó de traer más filas que el tope, la sincronización no
 * borra nada y lo dice. Si ese borrado es de verdad —una limpieza grande—,
 * quien lo miró lo confirma repitiendo la llamada con `?confirmar_borrado=1`.
 *
 * Va como parámetro y no como opción guardada a propósito: vale para **esta**
 * corrida. El cron nunca lo manda, así que un borrado masivo siempre lo
 * autoriza una persona que vio el número.
 */
const confirmaElBorrado = (request: Request) =>
  new URL(request.url).searchParams.get("confirmar_borrado") === "1";

/**
 * El otro freno de mano: el de las reprogramaciones que trajo la planilla.
 *
 * Cuando la planilla movió la fecha de inicio de más órdenes que el tope, la
 * sincronización no registra **ninguna** en el historial y lo dice. Las fechas
 * se importan igual —la planilla manda—; lo que no queda es el renglón que
 * cuenta por qué se corrió ese trabajo. Si el movimiento es de verdad —alguien
 * reprogramó treinta órdenes de una— quien lo miró lo confirma repitiendo la
 * llamada con `?confirmar_reprogramaciones=1`.
 *
 * ── POR QUÉ SON DOS CONFIRMACIONES Y NO UNA ─────────────────────────────────
 *
 * Son dos parámetros, dos lectores y dos banderas, y **no se juntan**. Se
 * parecen tanto que ordenarlos en uno solo se ve como una limpieza, y es lo
 * contrario: una planilla a medio recalcular devuelve `Cargando…` en unas
 * celdas y vacías las demás, así que dispara los dos frenos a la vez. Con una
 * sola llave, quien confirmó un borrado grande estaría aceptando además, sin
 * verlo y sin que nada se lo nombre, cuatrocientas reprogramaciones inventadas
 * — que a diferencia del borrado **nada vuelve a borrar**: inflan el contador
 * de cada OT para siempre y en silencio.
 *
 * Una confirmación autoriza una cosa. Quien quiera las dos, manda las dos.
 * El cron no manda ninguna.
 */
const confirmaLasReprogramaciones = (request: Request) =>
  new URL(request.url).searchParams.get("confirmar_reprogramaciones") === "1";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sincronizar las órdenes de trabajo requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const r = await sincronizarOrdenes({
    sinFreno: confirmaElBorrado(request),
    sinFrenoDeReprogramaciones: confirmaLasReprogramaciones(request),
  });

  return r.ok
    ? NextResponse.json(r.datos)
    : NextResponse.json({ error: r.error, ...r.datos }, { status: r.status });
}
