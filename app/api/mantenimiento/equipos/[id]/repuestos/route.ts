import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";

/**
 * Los repuestos de un equipo: qué hay que tener a mano.
 *
 * Es una lista corta y a propósito: el nombre, el código si lo tiene y una
 * nota. El stock no vive acá.
 */

/** GET — los repuestos del equipo. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("equipos_repuestos")
    .select("*")
    .eq("equipment_id", id)
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** POST — un repuesto más. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cargar un repuesto requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("equipos_repuestos")
    .insert({
      equipment_id: id,
      name,
      code: String(b.code ?? "").trim() || null,
      notes: String(b.notes ?? "").trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

/** DELETE ?repuesto= — saca un repuesto de la lista. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Borrar un repuesto requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const repuesto = new URL(request.url).searchParams.get("repuesto");
  if (!repuesto) return NextResponse.json({ error: "Falta el repuesto" }, { status: 400 });

  const { error } = await createAdminClient()
    .from("equipos_repuestos")
    .delete()
    .eq("id", repuesto)
    .eq("equipment_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
