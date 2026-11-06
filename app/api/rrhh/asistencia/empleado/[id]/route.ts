import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { traerDiasDeAsistencia } from "@/lib/rrhh/asistenciaDeEmpleado";
import { rangoPedido } from "@/lib/rrhh/rangoPedido";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { desde, hasta } = rangoPedido(new URL(request.url).searchParams);
  return NextResponse.json(await traerDiasDeAsistencia(supabase, id, desde, hasta));
}
