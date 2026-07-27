import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";

function parseRange(url: URL) {
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  const hoy = new Date();
  const fechaHasta = hasta ? new Date(hasta) : hoy;
  const fechaDesde = desde ? new Date(desde) : new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { fechaDesde, fechaHasta };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { fechaDesde, fechaHasta } = parseRange(new URL(request.url));
  const desdeStr = utcDateOnlyFrom(fechaDesde).toISOString().slice(0, 10);
  const hastaStr = utcDateOnlyFrom(fechaHasta).toISOString().slice(0, 10);

  await recalcularEmpleadoPeriodo(supabase, id, fechaDesde, fechaHasta);

  const [{ data: calculos }, { data: fichadas }] = await Promise.all([
    supabase
      .from("calculos_diarios")
      .select("*")
      .eq("empleado_id", id)
      .gte("fecha", desdeStr)
      .lte("fecha", hastaStr)
      .order("fecha", { ascending: true }),
    supabase
      .from("fichadas")
      .select("id, fecha, hora_entrada, hora_salida")
      .eq("empleado_id", id)
      .gte("fecha", desdeStr)
      .lte("fecha", hastaStr)
      .order("hora_entrada", { ascending: true }),
  ]);

  const fichadasPorDia = new Map<string, typeof fichadas>();
  for (const f of fichadas ?? []) {
    const key = f.fecha as string;
    if (!fichadasPorDia.has(key)) fichadasPorDia.set(key, []);
    fichadasPorDia.get(key)!.push(f);
  }

  const dias = (calculos ?? []).map((c) => ({
    ...c,
    fichadas: fichadasPorDia.get(c.fecha as string) ?? [],
  }));

  return NextResponse.json(dias);
}
