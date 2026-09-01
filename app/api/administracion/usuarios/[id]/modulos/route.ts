import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";
import { MODULOS_ORDEN } from "@/lib/core/access";
import { cuerpoJson } from "@/lib/core/cuerpo";

// Misma fuente que la navegación y el panel: una lista propia acá ya dejó
// afuera a Compras una vez.
const MODULOS: readonly string[] = MODULOS_ORDEN;
const NIVELES = ["lectura", "edicion", "admin"] as const;

/**
 * Reemplaza el set completo de grants (usuario_modulos) de un usuario.
 * Body: { grants: { modulo: "rrhh"|"remises"|"mantenimiento", nivel: "lectura"|"edicion"|"admin" }[] }
 * (un módulo ausente del array = sin acceso a ese módulo)
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const grants = Array.isArray(body.grants) ? body.grants : [];
  for (const g of grants) {
    if (!MODULOS.includes(g.modulo) || !NIVELES.includes(g.nivel)) {
      return NextResponse.json({ error: "Grant inválido" }, { status: 400 });
    }
  }

  const admin = createAdminClient();

  const { error: errorDelete } = await admin.from("usuario_modulos").delete().eq("usuario_id", id);
  if (errorDelete) return NextResponse.json({ error: errorDelete.message }, { status: 500 });

  if (grants.length > 0) {
    const { error: errorInsert } = await admin
      .from("usuario_modulos")
      .insert(grants.map((g: { modulo: string; nivel: string }) => ({ usuario_id: id, modulo: g.modulo, nivel: g.nivel })));
    if (errorInsert) return NextResponse.json({ error: errorInsert.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
