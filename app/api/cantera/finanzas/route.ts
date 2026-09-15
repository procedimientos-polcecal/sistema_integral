import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminCantera } from "@/lib/cantera/auth";

/**
 * La lista de quiénes pueden conciliar una factura de cantera contra Odoo.
 *
 * Igual que `os_aprobadores`: pertenecer a la lista ES el permiso, y sólo el
 * admin del módulo la administra (RLS de `cantera_finanzas`, migración
 * 20260910103229) — no hace falta el cliente admin, a diferencia de
 * `os_aprobadores`, porque acá la política ya lo permite directo.
 */

async function guardia(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await esAdminCantera(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Administrar la lista de finanzas requiere nivel de administrador de Cantera" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const usuarioId = String(body?.usuario_id ?? "").trim();
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const { data, error } = await supabase
    .from("cantera_finanzas")
    .upsert({ usuario_id: usuarioId }, { onConflict: "usuario_id" })
    .select("usuario_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const usuarioId = new URL(request.url).searchParams.get("usuario_id") ?? "";
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const { error } = await supabase.from("cantera_finanzas").delete().eq("usuario_id", usuarioId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
