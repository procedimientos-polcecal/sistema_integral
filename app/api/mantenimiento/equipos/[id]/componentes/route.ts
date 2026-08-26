import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";

/**
 * Los componentes de un equipo: de qué está hecho.
 *
 * Vienen del relevamiento —del libro BD Equipos— y también se pueden cargar de
 * a uno cuando alguien encuentra algo que faltaba.
 */

const texto = (v: unknown) => String(v ?? "").trim() || null;

/** GET — los componentes del equipo. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("equipos_componentes")
    .select("*")
    .eq("equipment_id", id)
    .order("categoria")
    .order("nombre");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** POST — un componente más. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cargar un componente requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const nombre = String(b?.nombre ?? "").trim();
  if (!nombre) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("equipos_componentes")
    .insert({
      equipment_id: id,
      nombre,
      categoria: texto(b.categoria),
      especificacion: texto(b.especificacion),
      material: texto(b.material),
      cantidad: texto(b.cantidad),
      proveedor_critico: texto(b.proveedor_critico),
      criticidad: texto(b.criticidad),
      relevado_por: texto(b.relevado_por),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

/** DELETE ?componente= — saca un componente del equipo. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Borrar un componente requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const componente = new URL(request.url).searchParams.get("componente");
  if (!componente) return NextResponse.json({ error: "Falta el componente" }, { status: 400 });

  // Atado al equipo de la URL: así un id de otro equipo no borra nada.
  const { error } = await createAdminClient()
    .from("equipos_componentes")
    .delete()
    .eq("id", componente)
    .eq("equipment_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
