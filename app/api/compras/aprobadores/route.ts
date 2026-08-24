import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminCompras } from "@/lib/compras/auth";
import { puedeQuitarDeLaLista } from "@/lib/compras/bandeja";

/**
 * La lista de quiénes pueden aprobar en Compras.
 *
 * Estar en la lista ES el permiso de aprobar, las dos cosas: el requerimiento y
 * la compra. El alias es aparte: es con qué texto figura cada uno en el
 * desplegable estricto de la planilla, y sin él la aprobación se guarda igual
 * pero no llega allá.
 *
 * Administrar la lista es tarea de administración, no de aprobación: si
 * alcanzara con estar en ella, cualquier aprobador podría sacar a los demás.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function guardia(supabase: Supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  if (!(await esAdminCompras(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Administrar la lista de aprobadores requiere nivel de administrador del módulo" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** 23505 = alias repetido: la planilla no podría distinguir a dos personas. */
function mensajeDeError(error: { code?: string; message: string }): string {
  return error.code === "23505"
    ? "Ese alias ya lo usa otro aprobador: en la planilla no se podrían distinguir"
    : error.message;
}

/** Alta: sumar a alguien a la lista. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const usuarioId = String(body?.usuario_id ?? "").trim();
  const alias = String(body?.alias_planilla ?? "").trim();
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("compras_aprobadores")
    .upsert({ usuario_id: usuarioId, alias_planilla: alias || null }, { onConflict: "usuario_id" })
    .select("usuario_id, alias_planilla")
    .single();

  if (error) return NextResponse.json({ error: mensajeDeError(error) }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

/** Sólo el alias. Ya no da de baja: para eso está DELETE. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const usuarioId = String(body?.usuario_id ?? "").trim();
  const alias = String(body?.alias_planilla ?? "").trim();
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("compras_aprobadores")
    .update({ alias_planilla: alias || null })
    .eq("usuario_id", usuarioId)
    .select("usuario_id, alias_planilla")
    .single();

  if (error) return NextResponse.json({ error: mensajeDeError(error) }, { status: 400 });
  return NextResponse.json(data);
}

/** Baja: sacar a alguien de la lista. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const usuarioId = new URL(request.url).searchParams.get("usuario_id") ?? "";
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const admin = createAdminClient();
  const { count } = await admin
    .from("compras_aprobadores")
    .select("usuario_id", { count: "exact", head: true });

  const permitido = puedeQuitarDeLaLista(count ?? 0);
  if (!permitido.ok) return NextResponse.json({ error: permitido.motivo }, { status: 409 });

  const { error } = await admin
    .from("compras_aprobadores")
    .delete()
    .eq("usuario_id", usuarioId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
