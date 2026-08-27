import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { idsOrDummy } from "@/lib/rrhh/dashboardHelpers";
import { recalcularPeriodoCacheado } from "@/lib/rrhh/recalcCache";
import { traerPaginado } from "@/lib/rrhh/paginado";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";
import { SECTORES_LUNES_A_VIERNES } from "@/lib/rrhh/constants";

function esDiaEsperado(tipoDia: string, trabajaLunesAViernesNomas: boolean): boolean {
  return tipoDia !== "DOMINGO" && !(trabajaLunesAViernesNomas && tipoDia === "SABADO");
}

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, sectores(nombre)")
    .eq("activo", true);
  const lista = empleados ?? [];
  const empleadoIds = lista.map((e) => e.id);
  const empleadoById = new Map(lista.map((e) => [e.id, e]));

  const hoy = utcDateOnlyFrom(new Date());
  const meses: { desde: Date; hasta: Date; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const base = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    const desde = utcDateOnlyFrom(base);
    const finMes = utcDateOnlyFrom(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)));
    const hasta = i === 0 ? hoy : finMes;
    const label = desde.toLocaleDateString("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" });
    meses.push({ desde, hasta, label });
  }

  const resultado = [];
  for (const mes of meses) {
    await recalcularPeriodoCacheado(supabase, mes.desde, mes.hasta);
    const calculos = await traerPaginado<{ empleado_id: string; tipo_dia: string; ausente: boolean }>(
      () =>
        supabase
          .from("calculos_diarios")
          .select("empleado_id, tipo_dia, ausente")
          .in("empleado_id", idsOrDummy(empleadoIds))
          .gte("fecha", mes.desde.toISOString().slice(0, 10))
          .lte("fecha", mes.hasta.toISOString().slice(0, 10))
          .order("id"),
      `ausentismo de ${mes.label}`
    );

    let esperados = 0;
    let ausentes = 0;
    for (const c of calculos) {
      const emp = empleadoById.get(c.empleado_id);
      const sectorNombre = (emp?.sectores as unknown as { nombre: string } | null)?.nombre ?? null;
      const trabajaLunesAViernesNomas = !!sectorNombre && SECTORES_LUNES_A_VIERNES.includes(sectorNombre);
      if (esDiaEsperado(c.tipo_dia, trabajaLunesAViernesNomas)) {
        esperados += 1;
        if (c.ausente) ausentes += 1;
      }
    }
    resultado.push({ mes: mes.label, ausentismo: esperados > 0 ? Math.round((ausentes / esperados) * 1000) / 10 : 0 });
  }

  return NextResponse.json(resultado);
}
