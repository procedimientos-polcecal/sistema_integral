import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { noSePudoAveriguar, puedeEditarVentas, tieneAccesoVentas } from "@/lib/ventas/auth";
import { esquemaDeActividad, problemaDelProximoPaso } from "@/lib/ventas/crm/cuerpos";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";

/**
 * Las actividades: lo pendiente (GET) y registrar una (POST).
 *
 * ── EL GET DEVUELVE SÓLO LO QUE TIENE PRÓXIMO PASO SIN CUMPLIR ──
 *
 * Es la pantalla de seguimiento, no el historial. El historial de un cliente se
 * lee con su ficha, que lo trae completo y ordenado. Acá el filtro va en SQL
 * —`not.is.null` sobre `proximo_paso_el` y `is.null` sobre `cumplido_el`,
 * justo el índice parcial `ventas_act_pendientes`— y no en memoria, porque esta
 * tabla es la que va a crecer primero: una actividad por llamado, por catorce
 * personas, todos los días.
 *
 * **No recorta por fecha.** Lo vencido es todo lo vencido: esconder lo de hace
 * dos meses es exactamente cómo se pierde un cliente. El recorte a una semana
 * es sólo del conteo del tablero, y lo hace `resumirPasos`.
 *
 * ── `hecha_por` LO PONE LA RUTA ─────────────────────────────
 *
 * Con el usuario de la sesión, siempre, y la policy de insert lo exige además
 * del otro lado. Un registro de quién habló con quién que se puede firmar a
 * nombre de otro no sirve para nada.
 *
 * La **fecha**, en cambio, se tipea y la ruta no la toca: la visita se registra
 * a la mañana siguiente, igual que los cuatro horarios de una orden de carga.
 * `creada_en` guarda aparte cuándo se tipeó, que es otra cosa.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await tieneAccesoVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) return NextResponse.json({ error: "No tenés acceso a Ventas" }, { status: 403 });

  try {
    const pendientes = await traerTodo((desde, hasta) =>
      supabase
        .from("ventas_actividades")
        .select(
          "id, cliente_id, contacto_id, oportunidad_id, tipo, fecha, resumen, proximo_paso, proximo_paso_el, cumplido_el, hecha_por"
        )
        .not("proximo_paso_el", "is", null)
        .is("cumplido_el", null)
        .order("proximo_paso_el")
        .range(desde, hasta)
    );
    return NextResponse.json({ pendientes });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo leer el seguimiento: ${(e as Error).message}` },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json(
      { error: "No tenés permiso para registrar actividades" },
      { status: 403 }
    );
  }

  const r = validar(esquemaDeActividad, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const a = r.datos;

  // Los dos juntos o ninguno. La tabla también lo exige, pero ese rechazo llega
  // como un 23514 que no dice nada en castellano.
  const problema = problemaDelProximoPaso(a.proximo_paso, a.proximo_paso_el);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  const { data, error } = await supabase
    .from("ventas_actividades")
    .insert({
      cliente_id: a.cliente_id,
      contacto_id: a.contacto_id ?? null,
      oportunidad_id: a.oportunidad_id ?? null,
      tipo: a.tipo,
      ...(a.fecha ? { fecha: a.fecha } : {}),
      resumen: a.resumen,
      proximo_paso: a.proximo_paso ?? null,
      proximo_paso_el: a.proximo_paso_el ?? null,
      cumplido_el: a.cumplido_el ?? null,
      hecha_por: user.id,
    })
    .select(
      "id, cliente_id, contacto_id, oportunidad_id, tipo, fecha, resumen, proximo_paso, proximo_paso_el, cumplido_el, hecha_por, creada_en"
    )
    .single();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "No existe ese cliente, contacto u oportunidad" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: `No se pudo guardar la actividad: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ actividad: data }, { status: 201 });
}
