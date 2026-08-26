import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { leerValores, leerFormulas, listarPestanas } from "@/lib/core/sheets";
import { linkDeCelda } from "@/lib/core/links";
import { cargarEnlaces, resolver } from "@/lib/mantenimiento/enlaces";
import {
  OS_PESTANAS, mapearEncabezados, filaDeOS, seguimientoHuerfano,
} from "@/lib/mantenimiento/os";

export const maxDuration = 300;

/**
 * Trae las órdenes de servicio de su planilla.
 *
 * La planilla tiene una pestaña por área y cada una arma su encabezado a su
 * manera, así que cada pestaña se mapea por separado antes de leer sus filas.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sincronizar las órdenes de servicio requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const planilla = process.env.GOOGLE_SHEETS_OS_ID ?? "";
  if (!planilla) {
    return NextResponse.json(
      { error: "Falta configurar GOOGLE_SHEETS_OS_ID" },
      { status: 503 }
    );
  }

  const admin = createAdminClient();
  const enlaces = await cargarEnlaces(admin);
  const cuando = new Date().toISOString();

  // Una OS puede aparecer en la hoja maestra y en la de su área: se queda la
  // última leída, y por eso se ordena por número recién al final.
  const porNumero = new Map<number, Record<string, unknown>>();
  const sinLeer: string[] = [];
  const huerfanas: string[] = [];
  let sinEquipo = 0;

  for (const pestana of OS_PESTANAS) {
    let filas: string[][];
    try {
      filas = await leerValores(planilla, pestana, { sinFormato: true });
    } catch {
      sinLeer.push(pestana);
      continue;
    }
    if (filas.length < 2) continue;

    const idx = mapearEncabezados(filas[0]);

    // La comparativa es un `HYPERLINK` y la celda sólo muestra "LINK": la URL
    // hay que sacarla de la fórmula o del hipervínculo, o se guarda la palabra.
    const formulas = idx.comparativa >= 0
      ? await leerFormulas(planilla, pestana).catch(() => [] as string[][])
      : [];

    for (let i = 1; i < filas.length; i++) {
      const os = filaDeOS(filas[i], idx, pestana, i + 1);

      if (!os) {
        // Seguimiento sin orden: el FILTER corrió las filas y lo escrito a
        // mano quedó colgado de ninguna OS. No se importa, se avisa.
        if (seguimientoHuerfano(filas[i])) huerfanas.push(`${pestana}!${i + 1}`);
        continue;
      }

      const link = linkDeCelda(formulas[i]?.[idx.comparativa], null);
      const { equipment_id, sector_id } = resolver(enlaces, os);
      if (!equipment_id) sinEquipo += 1;

      porNumero.set(os.os_number, {
        ...os,
        comparativa: link ?? os.comparativa,
        equipment_id,
        sector_id,
        synced_at: cuando,
      });
    }
  }

  const registros = [...porNumero.values()];
  if (registros.length === 0) {
    return NextResponse.json(
      {
        error:
          sinLeer.length === OS_PESTANAS.length
            ? "No se pudo leer ninguna pestaña de la planilla."
            : "La planilla no tiene ninguna orden de servicio cargada.",
        sin_leer: sinLeer,
        pestanas: await listarPestanas(planilla).catch(() => []),
      },
      { status: 502 }
    );
  }

  let guardadas = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    const { error } = await admin
      .from("ordenes_servicio")
      .upsert(lote, { onConflict: "os_number" });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    guardadas += lote.length;
  }

  return NextResponse.json({
    guardadas,
    sin_equipo: sinEquipo,
    sin_leer: sinLeer,
    huerfanas,
  });
}
