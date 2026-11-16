import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { cuentaDeUnRepuesto } from "@/lib/mantenimiento/cuentaDeUnRepuesto";

/**
 * A qué artículo del pañol se refiere un renglón de repuesto de una OT.
 *
 * Lo elige una persona y **nunca se completa por parecido de nombre**: enlazar
 * al que se le parece es peor que dejar en null. Soltarlo deja `articulo_id` en
 * null y no borra el renglón. Los RI pegados al renglón se quedan donde están.
 * Las dos devuelven la cuenta de lo que viene, que cambia al cambiar de artículo.
 */

type Params = { params: Promise<{ id: string }> };

const esquema = z.object({ articulo_id: z.string().min(1, "Falta el artículo") });

async function conPermiso() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Elegir el artículo de un repuesto requiere nivel de edición en Mantenimiento" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

async function guardar(id: string, articuloId: string | null) {
  const admin = createAdminClient();

  const { data: renglon } = await admin
    .from("ordenes_trabajo_repuestos")
    .select("id, work_order_id, articulo_id")
    .eq("id", id)
    .maybeSingle();
  if (!renglon) return NextResponse.json({ error: "No existe ese repuesto" }, { status: 404 });

  if (articuloId !== null) {
    const { data: articulo } = await admin
      .from("inventario_articulos").select("id").eq("id", articuloId).maybeSingle();
    if (!articulo) return NextResponse.json({ error: "No existe ese artículo del pañol" }, { status: 404 });
  }

  const { error } = await admin
    .from("ordenes_trabajo_repuestos")
    .update({ articulo_id: articuloId })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try {
    const cuenta = await cuentaDeUnRepuesto(admin, { ...renglon, articulo_id: articuloId });
    return NextResponse.json({ data: { articulo_id: articuloId }, cuenta });
  } catch (e) {
    // Quedó guardado; sólo la cuenta no se pudo armar.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** PUT — `{ articulo_id }`. */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;

  const r = validar(esquema, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  return guardar(id, r.datos.articulo_id);
}

/** DELETE — suelta el artículo; el renglón queda. */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;
  return guardar(id, null);
}
