import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { generarRutasParaTurno } from "@/lib/remises/generarRutas";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const { fecha, turnoId, tipo } = body;
  if (!fecha || !turnoId || (tipo !== "ida" && tipo !== "vuelta")) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const resultado = await generarRutasParaTurno(supabase, { fecha, turnoId, tipo });
  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: 400 });
  return NextResponse.json(resultado);
}
