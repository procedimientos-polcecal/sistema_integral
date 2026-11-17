import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const { fecha, turnoId, tipo, todos } = body;
  if (!fecha || !turnoId || !tipo) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  if (!todos) {
    await supabase.from("remises_plan_semana").delete().eq("fecha", fecha).eq("turno_id", turnoId).eq("tipo", tipo);
    return NextResponse.json({ ok: true });
  }

  /*
   * "Todos" son los del turno, no los 69 empleados activos.
   *
   * Antes insertaba a todo el mundo, y eso es la otra mitad del bug del filtro
   * por turno: de los 69, sólo 25 tienen datos de Remises y 44 no tienen ni
   * dirección ni coordenadas, así que el plan quedaba lleno de gente que la
   * generación de rutas después descarta. Además volvía a llenar la lista de
   * la pantalla, porque a los marcados se los muestra siempre.
   *
   * A quien ya esté marcado por fuera de su turno habitual no se lo toca: el
   * upsert con `ignoreDuplicates` no borra, y el 34% de las filas de esta
   * tabla son justamente de gente marcada en otro turno (medido el
   * 05/11/2026).
   */
  const delTurno = await traerTodo((desde, hasta) =>
    supabase
      .from("remises_empleados_datos")
      .select("empleado_id, empleados!inner(activo)")
      .eq("turno_default_id", turnoId)
      .eq("empleados.activo", true)
      .range(desde, hasta)
  );
  const filas = delTurno.map((e) => ({ empleado_id: e.empleado_id, fecha, turno_id: turnoId, tipo }));
  if (filas.length > 0) {
    await supabase.from("remises_plan_semana").upsert(filas, { onConflict: "empleado_id,fecha,turno_id,tipo", ignoreDuplicates: true });
  }
  return NextResponse.json({ ok: true });
}
