import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminCompras } from "@/lib/compras/auth";
import { puedeQuitarDeLaListaDeOS } from "@/lib/mantenimiento/aprobacion";

/**
 * La lista de quiénes pueden aprobar una **orden de servicio**.
 *
 * Aparte de `compras_aprobadores` a propósito: aprobar un servicio y aprobar un
 * material los decide gente distinta. Estar en ella ES el permiso, igual que
 * allá, y no depende de ningún nivel.
 *
 * Sin alias: la planilla de Compras firma la aprobación con un nombre corto en
 * un desplegable estricto, la de OS no firma —su columna de estado dice
 * `APROBADO` y nada más—.
 *
 * Administrarla es tarea de administración y no de aprobación: si alcanzara con
 * estar en ella, cualquier aprobador podría sacar a los demás. Es la misma
 * guardia que la lista hermana.
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

/** Alta: sumar a alguien a la lista. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const usuarioId = String(body?.usuario_id ?? "").trim();
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("os_aprobadores")
    .upsert({ usuario_id: usuarioId }, { onConflict: "usuario_id" })
    .select("usuario_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
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
    .from("os_aprobadores")
    .select("usuario_id", { count: "exact", head: true });

  const permitido = puedeQuitarDeLaListaDeOS(count ?? 0);
  if (!permitido.ok) return NextResponse.json({ error: permitido.motivo }, { status: 409 });

  const { error } = await admin
    .from("os_aprobadores")
    .delete()
    .eq("usuario_id", usuarioId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
