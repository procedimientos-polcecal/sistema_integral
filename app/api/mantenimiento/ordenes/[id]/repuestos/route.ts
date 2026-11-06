import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { risDelRepuesto, type RiPosible } from "@/lib/mantenimiento/riDelRepuesto";

/**
 * Los repuestos que hacen falta para hacer una orden.
 *
 * La planilla tiene una sola columna de repuesto, texto libre. Esto es la
 * lista de verdad: qué hay que conseguir, con su código, para poder pedirlo o
 * buscarlo en el pañol. No se escribe en la planilla porque no tiene dónde.
 */

type Params = { params: Promise<{ id: string }> };

/** GET — los repuestos de la orden. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("ordenes_trabajo_repuestos")
    .select("*")
    .eq("work_order_id", id)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Si alguno ya está pedido ────────────────────────────────
  //
  // Para no pedirlo dos veces. Se traen **los requerimientos en curso una sola
  // vez** y se cruzan acá en memoria, en vez de una consulta por repuesto: son
  // unos quinientos —de 2.198, 1.646 están recibidos— y la coincidencia por
  // nombre no se puede escribir como filtro de PostgREST sin volverla otra
  // regla distinta de la que tiene los tests.
  //
  // `RECIBIDO` se descarta en la consulta porque es el 75% y no hace falta
  // traerlo; el resto lo decide `estaEnVuelo`, que es la que sabe. El `or` con
  // `is.null` está porque un `not.in` deja afuera los nulos, y un estado vacío
  // tiene que contar como en curso.
  //
  // Si esto falla, la lista de repuestos se devuelve igual: saber qué hace
  // falta no depende de saber si ya se pidió.
  const ris = await traerTodo<RiPosible & { cantidad: number | null; fecha: string }>(
    (desde, hasta) =>
      supabase
        .from("compras_requerimientos")
        .select("nro_ri, descripcion, codigo, cantidad, fecha, estado_aprobacion, estado_compra")
        .or("estado_compra.is.null,estado_compra.neq.RECIBIDO")
        .order("nro_ri", { ascending: false })
        .range(desde, hasta)
  ).catch(() => []);

  return NextResponse.json({
    data: (data ?? []).map((r) => ({
      ...r,
      ris: risDelRepuesto({ nombre: r.nombre, codigo: r.codigo }, ris),
    })),
  });
}

/** POST — sumar un repuesto a la lista. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cargar repuestos requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const nombre = String(b?.nombre ?? "").trim();
  if (!nombre) return NextResponse.json({ error: "Falta el nombre del repuesto" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("ordenes_trabajo_repuestos")
    .insert({
      work_order_id: id,
      nombre,
      codigo: String(b.codigo ?? "").trim() || null,
      cantidad: String(b.cantidad ?? "").trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

/** DELETE ?repuesto= — sacarlo de la lista. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sacar un repuesto requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const repuesto = new URL(request.url).searchParams.get("repuesto");
  if (!repuesto) return NextResponse.json({ error: "Falta el repuesto" }, { status: 400 });

  // Atado a la orden de la URL: así un id de otra orden no borra nada.
  const { error } = await createAdminClient()
    .from("ordenes_trabajo_repuestos")
    .delete()
    .eq("id", repuesto)
    .eq("work_order_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
