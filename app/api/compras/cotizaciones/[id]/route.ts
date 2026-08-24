import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { leerComparativa, vaciarFila } from "@/lib/compras/drive";
import { COLUMNAS_COMPARATIVA } from "@/lib/compras/comparativa";

const CAMPOS = [
  "marca", "unidad_medida", "precio_unitario", "cantidad", "costo_envio",
  "descuento", "iva", "precio_hasta", "plazo_pago_dias", "condiciones_pago",
  "disponibilidad", "comentario", "url",
] as const;

const CONGELADOS = ["APROBADO", "PEDIDO", "RECIBIDO"];

type Admin = ReturnType<typeof createAdminClient>;

interface RequerimientoDeLaCotizacion {
  id: string;
  estado_compra: string;
  comparativa_drive_id: string | null;
}

/** La cotización con el estado de su requerimiento, para poder decidir. */
async function contexto(admin: Admin, id: string) {
  const { data } = await admin
    .from("compras_cotizaciones")
    .select("*, compras_requerimientos(id, estado_compra, comparativa_drive_id)")
    .eq("id", id)
    .single();
  return data;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const admin = createAdminClient();
  const cotizacion = await contexto(admin, id);
  if (!cotizacion) return NextResponse.json({ error: "El presupuesto no existe" }, { status: 404 });

  const ri = cotizacion.compras_requerimientos as unknown as RequerimientoDeLaCotizacion;
  if (CONGELADOS.includes(ri.estado_compra)) {
    return NextResponse.json(
      { error: "La comparativa quedó congelada al aprobarse la compra" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS) {
    if (campo in body) cambios[campo] = body[campo] === "" ? null : body[campo];
  }
  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No se envió ningún cambio válido" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("compras_cotizaciones")
    .update(cambios)
    .eq("id", id)
    .select("*, proveedores(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Editar acá no reescribe la fila de la planilla. Se avisa para que no se
  // asuma que Drive quedó al día.
  const aviso = cotizacion.drive_fila
    ? "El cambio se guardó en el sistema. La fila de la planilla no se reescribió: si hace falta, corregila ahí."
    : null;

  return NextResponse.json(aviso ? { ...data, aviso_drive: aviso } : data);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const admin = createAdminClient();
  const cotizacion = await contexto(admin, id);
  if (!cotizacion) return NextResponse.json({ error: "El presupuesto no existe" }, { status: 404 });

  const ri = cotizacion.compras_requerimientos as unknown as RequerimientoDeLaCotizacion;
  if (CONGELADOS.includes(ri.estado_compra)) {
    return NextResponse.json(
      { error: "La comparativa quedó congelada al aprobarse la compra" },
      { status: 409 }
    );
  }

  const { error } = await admin.from("compras_cotizaciones").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Sólo se vacía la fila que agregó la app. Las que vinieron de la planilla son
  // de la planilla: borrar el presupuesto acá no puede borrarle a nadie una
  // cotización que cargó a mano hace dos años.
  let avisoDrive: string | null = null;
  if (ri.comparativa_drive_id && cotizacion.drive_fila && cotizacion.origen === "app") {
    try {
      const planilla = await leerComparativa(ri.comparativa_drive_id);
      await vaciarFila(
        ri.comparativa_drive_id, planilla.pestana,
        cotizacion.drive_fila, COLUMNAS_COMPARATIVA.length
      );
    } catch (e) {
      avisoDrive =
        "El presupuesto se borró, pero la fila de la planilla quedó: " +
        (e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json({ ok: true, aviso_drive: avisoDrive });
}
