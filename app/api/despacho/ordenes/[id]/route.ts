import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarDespacho } from "@/lib/despacho/auth";
import { traerOrden } from "@/lib/despacho/consultas";
import { traerCatalogoDeProductos } from "@/lib/core/productos";
import { clasificacionDeLaOrden } from "@/lib/despacho/clasificacion";
import { espejarOrden } from "@/lib/despacho/espejo";
import { ORDEN_DE_HORARIOS, proximoHorario } from "@/lib/despacho/orden";
import type { HorarioDeOrden, OrdenDeCarga } from "@/lib/despacho/types";

/**
 * Marcar un horario, o corregir una orden.
 *
 * Son las dos cosas que hace la pantalla de la balanza y van por la misma ruta
 * porque terminan en el mismo lugar: si la orden queda cerrada, se escribe la
 * planilla.
 *
 * **Marcar guarda la hora del servidor, no una hora que llegó del navegador.**
 * El punto del módulo es que los horarios sean reales; aceptar la hora del
 * cliente sería aceptar el reloj de una PC que nadie controla, y encima
 * permitiría que un reintento del navegador cambiara el horario ya marcado.
 *
 * **Corregir no pide motivo, sólo deja rastro** de quién y cuándo. Es lo que ya
 * hace Producción con los partes, que también se transcriben y también se
 * equivocan, y no vale que dos módulos del mismo sistema resuelvan lo mismo
 * distinto.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarDespacho(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar órdenes" }, { status: 403 });
  }

  const orden = await traerOrden(supabase, id);
  if (!orden) return NextResponse.json({ error: "Esa orden no existe" }, { status: 404 });

  const b = await cuerpoJson(request);

  const cambios: Record<string, unknown> = {
    actualizado_por: user.id,
    actualizado_en: new Date().toISOString(),
  };

  if (b?.horario !== undefined) {
    const horario = String(b.horario) as HorarioDeOrden;
    if (!ORDEN_DE_HORARIOS.includes(horario)) {
      return NextResponse.json({ error: `Horario desconocido: ${horario}` }, { status: 400 });
    }

    /*
     * Sólo se marca el que sigue.
     *
     * La pantalla muestra un botón —el del próximo horario— así que el único
     * modo de llegar acá con otro es un doble toque contra una pantalla vieja, o
     * dos personas en la misma orden. Aceptarlo pisaría un horario ya marcado
     * con la hora de ahora, que es justo lo que no se puede deshacer sin mirar
     * la planilla. Corregir a mano sigue estando: es el otro camino de abajo.
     */
    const esperado = proximoHorario(orden);
    if (esperado !== horario) {
      return NextResponse.json(
        {
          error: esperado
            ? `Esa orden ya tiene marcado ese horario. Lo que sigue es "${esperado}".`
            : "Esa orden ya está cerrada. Para cambiarle un horario hay que corregirla.",
        },
        { status: 409 }
      );
    }

    cambios[horario] = new Date().toISOString();
  } else {
    // Corrección a mano. Los horarios llegan como ISO o null; el resto, texto.
    for (const horario of ORDEN_DE_HORARIOS) {
      if (b?.[horario] === undefined) continue;
      const valor = b[horario];
      if (valor === null || valor === "") {
        cambios[horario] = null;
        continue;
      }
      const t = new Date(String(valor));
      if (isNaN(t.getTime())) {
        return NextResponse.json({ error: `${horario} no es una hora válida` }, { status: 400 });
      }
      cambios[horario] = t.toISOString();
    }

    for (const campo of ["notas", "supervisor_raw", "cliente_raw", "producto_raw"]) {
      if (b?.[campo] === undefined) continue;
      const s = String(b[campo] ?? "").trim();
      cambios[campo] = s === "" ? null : s;
    }

    if (Object.keys(cambios).length === 2) {
      return NextResponse.json({ error: "No vino ningún cambio" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("despacho_ordenes_carga")
    .update(cambios)
    .eq("id", id)
    .select(
      "id, numero, fecha, empresa_id, odoo_picking_id, odoo_picking_name, odoo_sale_name, odoo_product_id, cliente_raw, producto_raw, cantidad, unidad, entrada_predio, inicio_carga, fin_carga, salida_predio, notas, supervisor_raw, supervisor_id, sheets_fila, sheets_pendiente, sheets_pendiente_en"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const actualizada = data as OrdenDeCarga;

  // La planilla se escribe cuando la orden está cerrada: los cuatro horarios ya
  // están. Antes de eso sería escribir una fila incompleta y reescribirla tres
  // veces. Una corrección posterior reescribe la misma fila (`sheets_fila`).
  if (!actualizada.salida_predio) {
    return NextResponse.json({ data: actualizada, planilla_error: null });
  }

  const catalogo = await traerCatalogoDeProductos(supabase);
  const espejo = await espejarOrden(actualizada, clasificacionDeLaOrden(actualizada, catalogo));

  // El pendiente se anota o se limpia; nunca queda a medias. Una fila que se
  // escribió bien después de fallar tiene que dejar de contarse como pendiente.
  const { data: conPlanilla } = await supabase
    .from("despacho_ordenes_carga")
    .update(
      espejo.ok
        ? { sheets_fila: espejo.fila, sheets_pendiente: null, sheets_pendiente_en: null }
        : {
            sheets_pendiente: espejo.error ?? "no se pudo escribir",
            sheets_pendiente_en: new Date().toISOString(),
          }
    )
    .eq("id", id)
    .select(
      "id, numero, fecha, empresa_id, odoo_picking_id, odoo_picking_name, odoo_sale_name, odoo_product_id, cliente_raw, producto_raw, cantidad, unidad, entrada_predio, inicio_carga, fin_carga, salida_predio, notas, supervisor_raw, supervisor_id, sheets_fila, sheets_pendiente, sheets_pendiente_en"
    )
    .single();

  return NextResponse.json({
    data: conPlanilla ?? actualizada,
    // Que la pantalla lo pueda decir. Sin esto, quien cerró la orden se va
    // convencido de que quedó en la planilla y la planilla no la tiene.
    planilla_error: espejo.ok ? null : espejo.error,
  });
}
