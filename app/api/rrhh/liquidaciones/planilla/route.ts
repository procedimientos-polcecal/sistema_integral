import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { calcularPlanillaGeneral, parseModalidad } from "@/lib/rrhh/planillaGeneral";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (!desde || !hasta) return NextResponse.json({ error: "Faltan desde/hasta" }, { status: 400 });

  const filas = await calcularPlanillaGeneral(supabase, desde, hasta, parseModalidad(url.searchParams.get("modalidadPago")));
  return NextResponse.json(filas);
}
