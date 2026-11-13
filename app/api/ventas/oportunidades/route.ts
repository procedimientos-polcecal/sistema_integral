import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { noSePudoAveriguar, puedeEditarVentas, tieneAccesoVentas } from "@/lib/ventas/auth";
import { esquemaDeOportunidad, problemaDelCierre } from "@/lib/ventas/crm/cuerpos";
import { estaAbierta } from "@/lib/ventas/crm/etapas";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";

/**
 * Las oportunidades: listarlas para el embudo (GET) y abrir una (POST).
 *
 * El GET trae **todas**, abiertas y cerradas, y el filtro lo hace la pantalla.
 * Es a propósito: el embudo muestra las seis columnas y la tasa de conversión
 * se calcula sobre lo cerrado, así que una ruta que devolviera sólo lo abierto
 * obligaría a un segundo pedido para el mismo tablero. Con `traerTodo()`, que
 * PostgREST corta en 1000 filas sin avisar.
 *
 * ── `cerrada_el` LO PONE LA RUTA Y NO QUIEN LLAMA ───────────
 *
 * Una oportunidad que nace cerrada —se carga una venta que ya se ganó— lleva la
 * fecha de hoy. Dejar que venga en el cuerpo permitiría cerrar algo con fecha
 * del mes que viene, y de esa fecha sale el informe del mes.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await tieneAccesoVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) return NextResponse.json({ error: "No tenés acceso a Ventas" }, { status: 403 });

  try {
    const oportunidades = await traerTodo((desde, hasta) =>
      supabase
        .from("ventas_oportunidades")
        .select(
          "id, numero, cliente_id, titulo, producto_id, toneladas_estimadas, monto_estimado, moneda, etapa, vendedor_id, fecha_estimada_cierre, cerrada_el, motivo_perdida, notas, creada_en"
        )
        .order("numero", { ascending: false })
        .range(desde, hasta)
    );
    return NextResponse.json({ oportunidades });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudieron leer las oportunidades: ${(e as Error).message}` },
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
      { error: "No tenés permiso para abrir oportunidades" },
      { status: 403 }
    );
  }

  const r = validar(esquemaDeOportunidad, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const o = r.datos;

  const etapa = o.etapa ?? "contacto_inicial";

  // Perder pide motivo. Es la única cosa obligatoria del módulo que no hace
  // falta para guardar la fila; el porqué está en `problemaDelCierre`.
  const problema = problemaDelCierre(etapa, o.motivo_perdida);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  const { data, error } = await supabase
    .from("ventas_oportunidades")
    .insert({
      cliente_id: o.cliente_id,
      titulo: o.titulo,
      producto_id: o.producto_id ?? null,
      toneladas_estimadas: o.toneladas_estimadas ?? null,
      monto_estimado: o.monto_estimado ?? null,
      moneda: o.moneda ?? "ARS",
      etapa,
      vendedor_id: o.vendedor_id ?? null,
      fecha_estimada_cierre: o.fecha_estimada_cierre ?? null,
      // Nace cerrada sólo si se la carga cerrada. La fecha la pone la ruta.
      cerrada_el: estaAbierta(etapa) ? null : hoyEnArgentina(),
      motivo_perdida: o.motivo_perdida ?? null,
      notas: o.notas ?? null,
      creada_por: user.id,
    })
    .select("id, numero, cliente_id, titulo, etapa")
    .single();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json({ error: "No existe ese cliente" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `No se pudo guardar la oportunidad: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ oportunidad: data }, { status: 201 });
}
