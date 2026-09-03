import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarInventario } from "@/lib/inventario/auth";

/**
 * Editar una fila de la lista del pañol.
 *
 * **Nada se borra.** Un solicitante o un destino que ya no se usa se desactiva:
 * los movimientos viejos apuntan a él, y borrarlo dejaría un kardex que no
 * puede decir quién retiró. `activo` es lo que lo saca del desplegable sin
 * perder la historia.
 *
 * Cambiar el nombre cambia lo que la app va a escribir en la planilla de ahí en
 * más, no lo ya escrito: los movimientos guardan el texto de entonces en
 * `solicitante` y `sector_raw`. Es a propósito — la fila 3.000 del kardex dice
 * lo que decía cuando se cargó.
 */
const EDITABLES: Record<string, readonly string[]> = {
  solicitante: ["nombre", "destino_id", "empleado_id", "activo"],
  destino: ["nombre", "sector_id", "activo"],
};

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarInventario(supabase, user.id))) {
    return NextResponse.json(
      { error: "Editar la lista requiere nivel de edición en Inventario" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const que = String(b?.que ?? "");
  const campos = EDITABLES[que];
  if (!campos) {
    return NextResponse.json({ error: "Qué se edita: solicitante o destino" }, { status: 400 });
  }

  // Lista blanca: lo que no está nombrado no llega a la base.
  const update: Record<string, unknown> = {};
  for (const campo of campos) {
    if (b?.[campo] === undefined) continue;
    // Un desplegable vacío es "sin enlace", no la cadena vacía: la columna es
    // uuid y "" la haría fallar con un error de tipo que no dice nada.
    update[campo] =
      campo.endsWith("_id") ? String(b[campo] ?? "").trim() || null : b[campo];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No se envió ningún cambio" }, { status: 400 });
  }

  const tabla = que === "destino" ? "inventario_destinos" : "inventario_solicitantes";
  const { data, error } = await createAdminClient()
    .from(tabla)
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    const ya = error.code === "23505";
    return NextResponse.json(
      { error: ya ? "Ya hay otro con ese nombre" : error.message },
      { status: ya ? 409 : 500 }
    );
  }
  return NextResponse.json({ data });
}
