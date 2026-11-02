import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { hoyEnArgentina } from "@/lib/core/fechas";

/**
 * Marcar un franco como tomado, o devolverlo a pendiente.
 *
 * `fecha_tomado` es **cuándo se formalizó** —el día del trámite— y la pone el
 * servidor.
 *
 * EL DIA DE DESCANSO YA NO SE PIDE, y conviene saber por qué, porque estuvo y
 * se sacó. Entre el 26/10 y el 02/11/2026 marcar tomado exigía cargar el día
 * que la persona no venía, para que la programación del taller pudiera cruzarlo.
 * A pedido del 02/11 se saca: en el circuito real el franco **es** el día que
 * ya tiene esas horas, y no hay otro día que anotar. Medido ese día: de 57
 * francos tomados, **uno solo** llegó a tener `fecha_descanso` en la semana que
 * el campo estuvo vivo.
 *
 * LO QUE ESTO CUESTA, DICHO: la programación semanal del taller cruza
 * `fecha_descanso` para abrir el hueco de quien descansa, y a partir de ahora
 * esa columna no se escribe más. No se rompe nada —ya trata el null como «no
 * se sabe», que es como quedaron los 56 francos viejos— pero deja de mostrar
 * francos en el cuadro. La columna se deja en la tabla a propósito: tiene un
 * dato real en una fila y borrarla sería DDL destructivo por una vuelta atrás
 * de una semana.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { estado } = await cuerpoJson(request);
  if (estado !== "PENDIENTE" && estado !== "TOMADO") {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  // Volver a pendiente borra las dos fechas, incluida la de descanso: puede
  // venir de una marca vieja, de cuando el día se cargaba, y dejarla ahí
  // mientras el franco figura pendiente le mentiría al cuadro del taller.
  const cambios =
    estado === "TOMADO"
      ? { estado, fecha_tomado: hoyEnArgentina() }
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
