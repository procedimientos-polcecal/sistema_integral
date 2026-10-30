import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esFechaIso, hoyEnArgentina } from "@/lib/core/fechas";

/**
 * Marcar un franco como tomado, o devolverlo a pendiente.
 *
 * LAS DOS FECHAS SON COSAS DISTINTAS, y confundirlas fue el bug que este
 * archivo arregla. `fecha_tomado` es **cuándo se formalizó** —el día del
 * trámite— y la pone el servidor. `fecha_descanso` es **el día que la persona
 * no viene**, y la carga quien marca: el franco se marca cuando se acuerda, así
 * que ese día ya se sabe y casi siempre está adelante.
 *
 * Hasta el 26/10/2026 existía sólo la primera y la pantalla le mandaba `hoy`,
 * así que los 56 francos tomados de entonces caen en tres fechas. La
 * programación del taller cruza `fecha_descanso` justamente para no creerle a
 * esas: las viejas quedan en null y no abren hueco, que es la verdad.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { estado, fechaDescanso } = await cuerpoJson(request);
  if (estado !== "PENDIENTE" && estado !== "TOMADO") {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  /*
   * Marcar tomado **exige** el día de descanso. Es el punto entero del cambio:
   * sin él vuelve a existir un franco tomado del que no se sabe cuándo se
   * descansa, que es lo que dejó a Mantenimiento sin poder cruzarlos.
   */
  if (estado === "TOMADO") {
    if (!esFechaIso(fechaDescanso)) {
      return NextResponse.json(
        { error: "Falta el día que lo descansa, o no es una fecha válida" },
        { status: 400 },
      );
    }
  }

  // Volver a pendiente borra las dos fechas: el franco deja de estar tomado, así
  // que no hay ni trámite ni día de descanso que valgan.
  const cambios =
    estado === "TOMADO"
      ? { estado, fecha_tomado: hoyEnArgentina(), fecha_descanso: fechaDescanso }
      : { estado, fecha_tomado: null, fecha_descanso: null };

  const { data, error } = await supabase
    .from("francos")
    .update(cambios)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ese franco ya no existe" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { error } = await supabase.from("francos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
