import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { idsOrDummy, rangoDesdeHasta } from "@/lib/rrhh/dashboardHelpers";
import { getConfigLiquidacion } from "@/lib/rrhh/engine/recalcular";
import { SECTORES_LUNES_A_VIERNES } from "@/lib/rrhh/constants";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const sectorId = url.searchParams.get("sectorId");
  const empresaId = url.searchParams.get("empresaId");
  if (!sectorId) return NextResponse.json({ error: "Falta sectorId" }, { status: 400 });
  const { desde, hasta } = rangoDesdeHasta(url.searchParams);

  const { data: sector } = await supabase.from("sectores").select("id, nombre").eq("id", sectorId).single();
  if (!sector) return NextResponse.json({ error: "Sector no encontrado" }, { status: 404 });
  const trabajaLunesAViernesNomas = SECTORES_LUNES_A_VIERNES.includes(sector.nombre);

  let query = supabase
    .from("empleados")
    .select("id, legajo, nombre, apellido, horas_teoricas_diarias, valor_hora_normal")
    .eq("sector_id", sectorId)
    .eq("activo", true);
  if (empresaId) query = query.eq("empresa_id", empresaId);
  const { data: empleados } = await query;
  const empleadoIds = (empleados ?? []).map((e) => e.id);

  const [{ data: calculos }, config] = await Promise.all([
    supabase
      .from("calculos_diarios")
      .select("empleado_id, tipo_dia, horas_normales, horas_extra_50, horas_extra_100")
      .in("empleado_id", idsOrDummy(empleadoIds))
      .gte("fecha", desde.toISOString().slice(0, 10))
      .lte("fecha", hasta.toISOString().slice(0, 10)),
    getConfigLiquidacion(supabase),
  ]);

  const empleadosResultado = (empleados ?? [])
    .map((e) => {
      const calcsEmpleado = (calculos ?? []).filter((c) => c.empleado_id === e.id);
      const horasNormales = calcsEmpleado.reduce((a, c) => a + Number(c.horas_normales), 0);
      const horasExtra50 = calcsEmpleado.reduce((a, c) => a + Number(c.horas_extra_50), 0);
      const horasExtra100 = calcsEmpleado.reduce((a, c) => a + Number(c.horas_extra_100), 0);
      const diasEsperados = calcsEmpleado.filter(
        (c) => c.tipo_dia !== "DOMINGO" && !(trabajaLunesAViernesNomas && c.tipo_dia === "SABADO")
      ).length;
      return {
        employeeId: e.id,
        legajo: e.legajo,
        nombre: `${e.apellido}, ${e.nombre}`,
        horasTrabajadas: Math.round((horasNormales + horasExtra50 + horasExtra100) * 10) / 10,
        horasTeoricas: Math.round(diasEsperados * Number(e.horas_teoricas_diarias) * 10) / 10,
        horasExtra50: Math.round(horasExtra50 * 10) / 10,
        horasExtra100: Math.round(horasExtra100 * 10) / 10,
        montoExtra50: Math.round(horasExtra50 * Number(e.valor_hora_normal) * config.multiplicadorExtra50),
        montoExtra100: Math.round(horasExtra100 * Number(e.valor_hora_normal) * config.multiplicadorExtra100),
      };
    })
    .sort((a, b) => b.horasTrabajadas - a.horasTrabajadas);

  return NextResponse.json({ sector: sector.nombre, empleados: empleadosResultado });
}
