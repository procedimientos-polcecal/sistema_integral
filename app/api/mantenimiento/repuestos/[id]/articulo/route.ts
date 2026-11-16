import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";
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
 *
 * **El 409 trae `ris_pegados`**: puede haber un vínculo cuyo RI la planilla ya dejó
 * de tener (no hay foreign key justamente para eso), y esa fila bloquea aunque la
 * cuenta no la vea. Con los números la pantalla puede ofrecer sacarlos uno por uno.
 * Y el 404 de un artículo inexistente gana sobre el 409: ver el comentario abajo.
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

  // **Primero se comprueba que el artículo nuevo exista, y recién después qué
  // bloquea.** Un artículo que no existe es un pedido que no puede salir bien
  // pase lo que pase: avisar antes de los RI mandaría a la persona a sacar
  // vínculos para toparse después con un 404.
  if (articuloId !== null) {
    const { data: articulo } = await admin
      .from("inventario_articulos").select("id").eq("id", articuloId).maybeSingle();
    if (!articulo) return NextResponse.json({ error: "No existe ese artículo del pañol" }, { status: 404 });
  }

  const viejo = (renglon.articulo_id as string | null) ?? null;
  if (viejo !== null && viejo !== articuloId) {
    // **Se leen de la tabla de vínculos y no de la cuenta, a propósito.** La
    // cuenta ignora un RI que la planilla ya no tiene (no trae nada); este
    // bloqueo no puede ignorarlo, porque la fila sigue ahí y sigue bloqueando.
    // Por eso el 409 **lleva los números**: la pantalla no los puede sacar de
    // `cuenta.ris`, y sin ellos la persona tendría que sacar vínculos que no ve.
    let pegados: { nro_ri: number }[];
    try {
      pegados = await traerTodo((d, h) =>
        admin.from("mant_ri_de_repuesto").select("nro_ri").eq("articulo_id", viejo).range(d, h)
      );
    } catch {
      return NextResponse.json({ error: "No se pudieron comprobar los RI del artículo actual" }, { status: 500 });
    }
    if (pegados.length > 0) {
      const ris = [...new Set(pegados.map((p) => p.nro_ri))].sort((x, y) => x - y);
      return NextResponse.json(
        {
          error:
            `El artículo actual tiene pegados los RI ${ris.join(", ")}, y valen para todas las órdenes que lo usan: ` +
            "sacalos antes de cambiar o soltar el artículo.",
          ris_pegados: ris,
        },
        { status: 409 }
      );
    }
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
