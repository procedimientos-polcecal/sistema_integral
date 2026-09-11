import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarDespacho } from "@/lib/despacho/auth";
import { traerOrden } from "@/lib/despacho/consultas";
import { traerCatalogoDeProductos } from "@/lib/core/productos";
import { clasificacionDeLaOrden } from "@/lib/despacho/clasificacion";
import { espejarOrden } from "@/lib/despacho/espejo";
import {
  ORDEN_DE_HORARIOS,
  horariosConLoTipeado,
  minutosDeLaHoraTipeada,
} from "@/lib/despacho/orden";
import type { HorarioDeOrden, OrdenDeCarga } from "@/lib/despacho/types";

/**
 * Completar o corregir los horarios de una orden.
 *
 * Es lo que hace la pantalla de la balanza, y termina donde tiene que terminar:
 * si la orden queda cerrada, se escribe la planilla.
 *
 * **Los cuatro horarios se tipean.** Hasta el 11/09/2026 la pantalla tenía un
 * botón por fila —el del próximo horario— y la hora la ponía el servidor, con
 * el argumento de que aceptar la del navegador es aceptar el reloj de una PC
 * que nadie controla. Ese diseño suponía que quien marca está mirando pasar el
 * camión, y resultó falso: **los horarios llegan tarde y de gente que no está
 * en Despacho**, así que el botón obligaba a marcar "ahora" una hora que había
 * pasado hace rato. Ahora los cuatro son campos y se pueden completar y
 * corregir en cualquier orden.
 *
 * Lo que sí se conserva del diseño viejo: **la hora llega como "HH:MM" y la
 * ancla el servidor** contra la fecha de la orden. El navegador no manda un
 * instante, así que su zona horaria y su reloj no entran en el dato — y la
 * regla del cruce de medianoche (`instanteEnElDia`) se aplica una sola vez, en
 * un solo lugar, igual que para el importador del libro.
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

  /*
   * Los horarios llegan tipeados, como "HH:MM", y se anclan a la fecha de la
   * orden. Una cadena vacía borra el horario: es un estado válido —una orden a
   * la que todavía no le informaron la salida— y no un error.
   *
   * El orden en que se anclan importa y lo resuelve `horariosConLoTipeado`: la
   * salida a las 00:30 sólo se entiende como del día siguiente si antes se sabe
   * que el fin de carga fue a las 23:40.
   */
  if (b?.horas !== undefined) {
    const horas = b.horas as Record<string, unknown>;
    if (typeof horas !== "object" || horas === null) {
      return NextResponse.json({ error: "Las horas tienen que venir en un objeto" }, { status: 400 });
    }

    const tipeadas: Partial<Record<HorarioDeOrden, string | null>> = {};
    for (const [clave, valor] of Object.entries(horas)) {
      const horario = clave as HorarioDeOrden;
      if (!ORDEN_DE_HORARIOS.includes(horario)) {
        return NextResponse.json({ error: `Horario desconocido: ${clave}` }, { status: 400 });
      }
      if (valor === null || valor === "") {
        tipeadas[horario] = null;
        continue;
      }
      if (minutosDeLaHoraTipeada(valor) === null) {
        return NextResponse.json(
          { error: `"${String(valor)}" no es una hora. Va como 07:35.` },
          { status: 400 }
        );
      }
      tipeadas[horario] = String(valor);
    }

    const resueltos = horariosConLoTipeado(orden, tipeadas, orden.fecha);
    for (const horario of Object.keys(tipeadas) as HorarioDeOrden[]) {
      cambios[horario] = resueltos[horario];
    }
  }

  for (const campo of ["notas", "supervisor_raw", "cliente_raw", "producto_raw"]) {
    if (b?.[campo] === undefined) continue;
    const s = String(b[campo] ?? "").trim();
    cambios[campo] = s === "" ? null : s;
  }

  if (Object.keys(cambios).length === 2) {
    return NextResponse.json({ error: "No vino ningún cambio" }, { status: 400 });
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
