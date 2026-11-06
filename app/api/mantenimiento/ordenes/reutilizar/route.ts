import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Una OT vieja, para cargar otra igual.
 *
 * Se cargan órdenes de trabajos ya hechos en tanda —varias del mismo día,
 * hechas por la misma gente sobre el mismo equipo—, así que el formulario de
 * Nueva OT puede traer una y completarse con ella. Qué se copia y qué no lo
 * decide `lib/mantenimiento/reutilizarOT.ts`, que es puro y tiene los tests;
 * acá sólo se busca y se devuelve.
 *
 * **Va con el cliente del usuario y no con el admin, a propósito.** Así quien
 * no puede ver una orden tampoco la puede copiar: RLS contesta "no existe", y
 * no hay que escribir un chequeo de permisos aparte que después se desincronice
 * del de la pantalla.
 *
 * Sólo lee.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const numero = Number(new URL(request.url).searchParams.get("numero") ?? "");
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    return NextResponse.json({ error: "Falta el número de OT" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ordenes_trabajo")
    // Una sola línea y sin concatenar: partida con `+` deja de ser un literal
    // y Supabase pierde la inferencia, que es la regla de CLAUDE.md. Pasó acá.
    // Las tres notas GUT se traen sólo para poder avisar que la vieja tenía un
    // puntaje: `copiarDeLaOT` no las copia, y por qué está en ese archivo.
    .select("id, ot_number, equipment_id, sector_id, especialidad, tipo, quien, descripcion, estado, contratista, horas, operario_1, operario_2, operario_3, prioridad, requiere_parada_sector, repuesto, gut_gravedad, gut_urgencia, gut_tendencia")
    .eq("ot_number", numero)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // El mismo mensaje para "no existe" y para "no la podés ver". Son dos cosas
  // distintas y a quien está cargando no le sirve la diferencia: lo que puede
  // hacer es el mismo en los dos casos.
  if (!data) {
    return NextResponse.json(
      { error: `No se encontró la OT ${numero}.` },
      { status: 404 }
    );
  }

  // Los renglones, en su tabla. Que falle esto no tira abajo la copia: se
  // traen los campos igual y el repuesto queda en el texto de la planilla,
  // que es de donde salen las 2.200 órdenes anteriores a los renglones.
  const { data: repuestos } = await supabase
    .from("ordenes_trabajo_repuestos")
    .select("nombre, cantidad, codigo")
    .eq("work_order_id", data.id)
    .order("created_at");

  return NextResponse.json({ data: { ...data, repuestos: repuestos ?? [] } });
}
