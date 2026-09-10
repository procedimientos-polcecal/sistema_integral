import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarProduccion } from "@/lib/produccion/auth";
import { armarElDia } from "@/lib/produccion/consultas";
import { espejarDia } from "@/lib/produccion/espejo";

/**
 * Reintentar la escritura de un día que quedó pendiente.
 *
 * Un pendiente casi siempre se arregla afuera —la planilla no tenía la fila del
 * 31, o falta la columna de un producto nuevo, o Google devolvió 429—, así que
 * el botón tiene que estar y no hace falta más que volver a intentar.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarProduccion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Tu usuario no tiene nivel de edición en Producción" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const fecha = String(b?.fecha ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "La fecha tiene que ser YYYY-MM-DD" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { ids, renglonesDePapel, produccion, despacho, rotura } = await armarElDia(admin, fecha);

  if (ids.length === 0) {
    return NextResponse.json({ error: `No hay partes cargados el ${fecha}` }, { status: 404 });
  }

  const resultado = await espejarDia({ fecha, renglonesDePapel, produccion, despacho, rotura });

  // Anotado (o limpiado) en **todos** los partes del día, y no sólo en el que
  // haya quedado pendiente: si la mañana falló y la tarde no está cargada
  // todavía, `ids` trae un solo id y esto se comporta igual que actualizar uno
  // solo. El caso que sí importa es el de dos turnos cargados: el reintento
  // exporta el día entero, así que su resultado — ok o el mismo error — vale
  // para los dos partes por igual. Mismo criterio que la exportación al
  // guardar un parte (`app/api/produccion/partes/route.ts`, paso 5): un
  // `.update().in("id", ids)` y no un `for` que repita la misma escritura una
  // vez por parte.
  await admin
    .from("produccion_partes")
    .update({
      sheets_pendiente: resultado.ok ? null : resultado.error,
      sheets_pendiente_en: resultado.ok ? null : new Date().toISOString(),
    })
    .in("id", ids);

  return NextResponse.json({
    planilla: resultado.ok ? "escrita" : "pendiente",
    error_planilla: resultado.ok ? null : resultado.error,
  });
}
