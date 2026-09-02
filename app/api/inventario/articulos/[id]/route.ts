import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminInventario } from "@/lib/inventario/auth";

/**
 * Editar un artículo del catálogo.
 *
 * **El stock no está entre lo editable, y es a propósito.** Sale de las fórmulas
 * de la planilla y lo escribe la sincronización: corregirlo a mano crearía un
 * número que la próxima corrida pisa sin avisar. Para cambiar cuánto hay se
 * carga un **ajuste**, que además deja constancia de quién lo contó y cuándo.
 *
 * `stock_seguridad` sí se edita: es una decisión de reposición, no una medición,
 * y la planilla no la calcula.
 */
const EDITABLES = [
  "descripcion", "ubicacion", "proveedores_ref", "marcas", "stock_seguridad", "activo",
] as const;

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminInventario(supabase, user.id))) {
    return NextResponse.json(
      { error: "Editar el catálogo requiere ser admin de Inventario" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);

  // Lista blanca: lo que no está nombrado no llega a la base.
  const update: Record<string, unknown> = {};
  for (const campo of EDITABLES) {
    if (b?.[campo] !== undefined) update[campo] = b[campo];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No se envió ningún cambio" }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("inventario_articulos")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
