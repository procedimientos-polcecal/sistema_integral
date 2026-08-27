import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";

/**
 * Guarda en qué orden hay que hacer las órdenes de trabajo.
 *
 * Es lo que sabe quien reparte el trabajo y los datos no: que el repuesto llega
 * el jueves, que conviene aprovechar que el sector está parado. Por eso pisa al
 * orden sugerido.
 *
 * No se escribe en la planilla: es una decisión del día a día, no un dato de la
 * orden, y la planilla no tiene dónde ponerlo.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Ordenar el trabajo requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const items: unknown = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "No se mandó ningún orden" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Un update por orden. Son las pendientes —treinta y pico—, no las mil
  // setecientas: no vale la pena una función en la base para esto.
  for (const item of items as { id?: string; orden?: number }[]) {
    const id = String(item?.id ?? "").trim();
    const orden = Number(item?.orden);
    if (!id || isNaN(orden)) continue;

    const { error } = await admin
      .from("ordenes_trabajo")
      .update({ orden_manual: orden })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, ordenadas: items.length });
}

/**
 * DELETE — vuelve al orden sugerido.
 *
 * Sin esto, el único modo de deshacer un orden que quedó viejo sería arrastrar
 * de nuevo las treinta.
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Ordenar el trabajo requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const { error } = await createAdminClient()
    .from("ordenes_trabajo")
    .update({ orden_manual: null })
    .not("orden_manual", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
