import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCalidad } from "@/lib/calidad/auth";
import { validarMuestra, type MuestraQueLlega } from "@/lib/calidad/ensayos/cuerpoDeLaMuestra";

/**
 * Corregir o borrar una muestra.
 *
 * Transcribir se equivoca, así que corregir tiene que ser barato. Queda quién
 * la cargó y quién la modificó por última vez; el historial completo de cada
 * edición no se guarda, igual que en Producción, y se puede agregar después sin
 * migrar nada de lo que ya existe.
 */

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para corregir muestras" }, { status: 403 });
  }

  const validado = validarMuestra(await cuerpoJson<MuestraQueLlega>(request));
  if ("problema" in validado) {
    return NextResponse.json({ error: validado.problema }, { status: 400 });
  }

  const { error } = await supabase
    .from("calidad_ensayos_muestras")
    .update({ ...validado.muestra, actualizado_por: user.id, actualizado_en: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Los retenidos se reemplazan enteros: editar fila por fila dejaría mallas
  // viejas que ya no se tamizaron, y una malla de más corre todos los
  // acumulados de ahí para abajo.
  const { error: errorBorrado } = await supabase
    .from("calidad_ensayos_retenidos")
    .delete()
    .eq("muestra_id", id);

  if (errorBorrado) {
    return NextResponse.json(
      { error: `No se pudieron reemplazar los retenidos: ${errorBorrado.message}` },
      { status: 400 }
    );
  }

  if (validado.retenidos.length > 0) {
    const { error: errorInsert } = await supabase
      .from("calidad_ensayos_retenidos")
      .insert(validado.retenidos.map((r) => ({ ...r, muestra_id: id })));

    if (errorInsert) {
      // Acá no se puede volver atrás —los viejos ya no están—, así que lo que
      // corresponde es decirlo fuerte y con lo que dijo Postgres sin traducir.
      return NextResponse.json(
        {
          error: `La muestra se guardó pero sus retenidos no: ${errorInsert.message}. Volvé a cargar la granulometría.`,
        },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para borrar muestras" }, { status: 403 });
  }

  // Los retenidos se van solos: la FK es `on delete cascade`.
  const { error } = await supabase.from("calidad_ensayos_muestras").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
