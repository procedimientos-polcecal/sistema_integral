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
 * null y no borra el renglón. Las dos devuelven la cuenta de lo que viene, que
 * cambia al cambiar de artículo.
 *
 * ── CAMBIAR O SOLTAR EL ARTÍCULO CON RI PEGADOS AL ARTÍCULO: SE NIEGA ────────
 *
 * Pegar un RI a un renglón con artículo lo escribe **sobre el artículo**, y esa
 * decisión la toma la ruta (`ri/route.ts`), no la persona: ella dijo «este RI es
 * de esta pieza». Esa fila no guarda de qué renglón vino (`repuesto_id` es null).
 * Si después se cambia el artículo del renglón y la fila vieja queda, **sigue
 * contando para todas las demás órdenes abiertas que piden el artículo viejo**:
 * una lee «cubierta» por un RI que nunca fue de su pieza, que es el anti-objetivo
 * de la función. Y desde esa pantalla ya no se puede sacar, porque el DELETE busca
 * en el artículo *nuevo*.
 *
 * Se podría borrar al cambiar, pero no se sabe cuáles de esas filas eran de este
 * renglón y cuáles las pegó otro renglón del mismo artículo: borrar es llevarse el
 * trabajo ajeno sin avisar. Por eso **se niega con un 409** mientras el artículo
 * viejo tenga RI pegados, y se dice cómo seguir: sacarlos primero (con el artículo
 * todavía puesto, el DELETE de `ri` los alcanza). Los RI pegados al *renglón*
 * (`repuesto_id`) se quedan, son suyos. Repetir el mismo artículo no es un cambio.
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

  const viejo = (renglon.articulo_id as string | null) ?? null;
  if (viejo !== null && viejo !== articuloId) {
    const { data: pegados } = await admin
      .from("mant_ri_de_repuesto").select("nro_ri").eq("articulo_id", viejo).range(0, 0);
    if (pegados === null) {
      return NextResponse.json({ error: "No se pudieron comprobar los RI del artículo actual" }, { status: 500 });
    }
    if (pegados.length > 0) {
      return NextResponse.json(
        {
          error:
            "El artículo actual tiene RI pegados, y valen para todas las órdenes que lo usan: " +
            "sacalos antes de cambiar o soltar el artículo.",
        },
        { status: 409 }
      );
    }
  }

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

  // Lo escrito ya está escrito: si sólo falla la cuenta se contesta 200 con una
  // advertencia, no 500 (que le diría a la persona que no se guardó).
  try {
    const cuenta = await cuentaDeUnRepuesto(admin, { ...renglon, articulo_id: articuloId });
    return NextResponse.json({ data: { articulo_id: articuloId }, cuenta });
  } catch (e) {
    console.error("[repuestos/articulo] la cuenta de lo que viene falló después de guardar:", e);
    return NextResponse.json({
      data: { articulo_id: articuloId },
      cuenta: null,
      advertencia: "Se guardó, pero no se pudo calcular lo que viene. Recargá la pantalla para verlo.",
    });
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
