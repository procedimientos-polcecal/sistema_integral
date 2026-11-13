import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminVentas, noSePudoAveriguar, puedeEditarVentas } from "@/lib/ventas/auth";
import { esquemaDeOportunidadParcial, problemaDelCierre } from "@/lib/ventas/crm/cuerpos";
import { estaAbierta, etapaDe, sePuedePasarDe } from "@/lib/ventas/crm/etapas";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { hoyEnArgentina } from "@/lib/core/fechas";

/**
 * Una oportunidad: corregirla o moverla de etapa (PATCH) y borrarla (DELETE).
 *
 * ── MOVER DE ETAPA NECESITA SABER DE DÓNDE VIENE ────────────
 *
 * Por eso la ruta lee la fila antes de escribir: `sePuedePasarDe` compara la
 * etapa que tenía con la que se pide. La única transición prohibida es **salir
 * de una cerrada**, y el motivo no es purismo: `cerrada_el` ya alimentó el
 * informe del mes, así que reabrirla dejaría una fecha de cierre sobre algo que
 * no está cerrado. Para eso se abre una oportunidad nueva, que además es lo que
 * de verdad pasó: el cliente volvió.
 *
 * ── `cerrada_el` SE ESCRIBE AL CRUZAR, NO EN CADA GUARDADO ──
 *
 * Se pone el día que la oportunidad pasa de abierta a cerrada, y no se vuelve a
 * tocar. Un PATCH posterior que corrija las notas de una oportunidad ganada no
 * puede correr la fecha de cierre al día de la corrección: ese número es el que
 * dice en qué mes se ganó.
 *
 * ── EL MOTIVO DE PÉRDIDA SE MIRA SOBRE EL RESULTADO ─────────
 *
 * `problemaDelCierre` recibe la etapa y el motivo **tal como van a quedar**,
 * fusionando lo que vino con lo que ya estaba. Mirarlo sólo sobre el cuerpo
 * dejaría pasar dos cosas: marcar «perdida» sin motivo cuando el cuerpo no
 * manda motivo, y borrar el motivo de una que ya estaba perdida.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json(
      { error: "No tenés permiso para corregir oportunidades" },
      { status: 403 }
    );
  }

  const r = validar(esquemaDeOportunidadParcial, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const o = r.datos;

  // Reasignar el vendedor es de `admin`, igual que en el cliente.
  if ("vendedor_id" in o) {
    const esAdmin = await esAdminVentas(supabase, user.id);
    if (!esAdmin.ok) return noSePudoAveriguar(esAdmin);
    if (!esAdmin.si) {
      return NextResponse.json(
        { error: "Reasignar el vendedor de una oportunidad requiere nivel admin en Ventas" },
        { status: 403 }
      );
    }
  }

  const { data: actual, error: errorDeLectura } = await supabase
    .from("ventas_oportunidades")
    .select("id, etapa, motivo_perdida, cerrada_el")
    .eq("id", id)
    .maybeSingle();
  if (errorDeLectura) {
    return NextResponse.json(
      { error: `No se pudo leer la oportunidad: ${errorDeLectura.message}` },
      { status: 503 }
    );
  }
  if (!actual) return NextResponse.json({ error: "No existe esa oportunidad" }, { status: 404 });

  const cambios: Record<string, unknown> = {};
  for (const campo of [
    "titulo",
    "producto_id",
    "toneladas_estimadas",
    "monto_estimado",
    "moneda",
    "fecha_estimada_cierre",
    "motivo_perdida",
    "notas",
    "vendedor_id",
  ] as const) {
    if (campo in o) cambios[campo] = o[campo] ?? null;
  }

  if ("etapa" in o && o.etapa) {
    if (!sePuedePasarDe(actual.etapa, o.etapa)) {
      const nombreDeAhora = etapaDe(actual.etapa)?.nombre ?? actual.etapa;
      return NextResponse.json(
        {
          error:
            `Esta oportunidad está ${nombreDeAhora.toLowerCase()} y de ahí no se vuelve. ` +
            `Si el cliente volvió, abrí una oportunidad nueva.`,
        },
        { status: 409 }
      );
    }
    cambios.etapa = o.etapa;

    // La fecha de cierre se escribe **al cruzar** de abierta a cerrada, y no se
    // vuelve a tocar: ese número dice en qué mes se ganó o se perdió.
    if (estaAbierta(actual.etapa) && !estaAbierta(o.etapa)) {
      cambios.cerrada_el = hoyEnArgentina();
    }
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No mandaste ningún cambio" }, { status: 400 });
  }

  // Sobre lo que va a quedar, no sobre lo que vino. Ver el encabezado.
  const etapaResultante = (cambios.etapa as string | undefined) ?? actual.etapa;
  const motivoResultante =
    "motivo_perdida" in cambios
      ? (cambios.motivo_perdida as string | null)
      : actual.motivo_perdida;

  const problema = problemaDelCierre(etapaResultante, motivoResultante);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  const { data, error } = await supabase
    .from("ventas_oportunidades")
    .update(cambios)
    .eq("id", id)
    .select(
      "id, numero, cliente_id, titulo, producto_id, toneladas_estimadas, monto_estimado, moneda, etapa, vendedor_id, fecha_estimada_cierre, cerrada_el, motivo_perdida, notas"
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: `No se pudo guardar el cambio: ${error.message}` },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "No existe esa oportunidad o no podés tocarla" },
      { status: 404 }
    );
  }

  return NextResponse.json({ oportunidad: data });
}

/**
 * Borrar una oportunidad es de `admin`, y lo normal es darla por perdida.
 *
 * No se audita, al revés que borrar un cliente, y la diferencia es qué se
 * pierde: las actividades de esta oportunidad **no se van con ella**
 * (`on delete set null`), así que el registro de lo que se habló queda. Lo que
 * desaparece es el monto estimado y la etapa, que son una previsión y no un
 * hecho. Lo que `auditar()` cubre en este repo es lo que no tiene vuelta atrás
 * y deja un hueco donde había un dato.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await esAdminVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json(
      {
        error:
          "Borrar una oportunidad requiere nivel admin en Ventas. " +
          "Si no se concretó, lo que corresponde es darla por perdida con su motivo.",
      },
      { status: 403 }
    );
  }

  const { error } = await supabase.from("ventas_oportunidades").delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: `No se pudo borrar la oportunidad: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
