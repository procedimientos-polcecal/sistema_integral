import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const hoy = new Date();
  const fechaHasta = url.searchParams.get("hasta") ? new Date(url.searchParams.get("hasta")!) : hoy;
  const fechaDesde = url.searchParams.get("desde")
    ? new Date(url.searchParams.get("desde")!)
    : new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const { data: faltas, error } = await supabase
    .from("calculos_diarios")
    .select("*, empleados(id, legajo, nombre, apellido)")
    .eq("ausente", true)
    .is("justificada", null)
    .gte("fecha", fechaDesde.toISOString().slice(0, 10))
    .lte("fecha", fechaHasta.toISOString().slice(0, 10))
    .order("fecha", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(faltas);
}
