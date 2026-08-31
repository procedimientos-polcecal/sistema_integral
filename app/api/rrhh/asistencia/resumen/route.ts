import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { SECTORES_LUNES_A_VIERNES } from "@/lib/rrhh/constants";
import { traerPaginado } from "@/lib/rrhh/paginado";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const sectorId = url.searchParams.get("sectorId");
  const hoy = new Date();
  const fechaHasta = url.searchParams.get("hasta") ? new Date(url.searchParams.get("hasta")!) : hoy;
  const fechaDesde = url.searchParams.get("desde")
    ? new Date(url.searchParams.get("desde")!)
    : new Date(hoy.getFullYear(), hoy.getMonth(), 1);


  let query = supabase.from("empleados").select("id, legajo, nombre, apellido, sectores(nombre)").eq("activo", true);
  if (sectorId) query = query.eq("sector_id", sectorId);
  const { data: empleados } = await query;

  const empleadoIds = (empleados ?? []).map((e) => e.id);
  const calculos = await traerPaginado<{
    empleado_id: string;
    tipo_dia: string;
    ausente: boolean;
    justificada: boolean | null;
  }>(
    () =>
      supabase
        .from("calculos_diarios")
        .select("empleado_id, tipo_dia, ausente, justificada")
        .in("empleado_id", empleadoIds.length > 0 ? empleadoIds : ["00000000-0000-0000-0000-000000000000"])
        .gte("fecha", fechaDesde.toISOString().slice(0, 10))
        .lte("fecha", fechaHasta.toISOString().slice(0, 10))
        .order("id"),
    "resumen de asistencia"
  );

  // Agrupado una sola vez: filtrar la lista completa por empleado dentro del
  // map era O(empleados x dias) y con el padron entero se notaba.
  const diasPorEmpleado = new Map<string, typeof calculos>();
  for (const c of calculos) {
    const arr = diasPorEmpleado.get(c.empleado_id);
    if (arr) arr.push(c);
    else diasPorEmpleado.set(c.empleado_id, [c]);
  }

  const porEmpleado = (empleados ?? []).map((emp) => {
    const sectorNombre = (emp.sectores as unknown as { nombre: string } | null)?.nombre ?? null;
    const trabajaLunesAViernesNomas = !!sectorNombre && SECTORES_LUNES_A_VIERNES.includes(sectorNombre);
    const dias = diasPorEmpleado.get(emp.id) ?? [];
    const diasEsperados = dias.filter(
      (d) => d.tipo_dia !== "DOMINGO" && !(trabajaLunesAViernesNomas && d.tipo_dia === "SABADO")
    ).length;
    const ausenciasInjustificadas = dias.filter((d) => d.ausente && d.justificada === false).length;
    const ausenciasSinClasificar = dias.filter((d) => d.ausente && d.justificada === null).length;
    const ausenciasJustificadas = dias.filter((d) => d.ausente && d.justificada === true).length;
    const presentes = diasEsperados - ausenciasInjustificadas - ausenciasSinClasificar - ausenciasJustificadas;
    const porcentajeAsistencia = diasEsperados > 0 ? Math.round(((presentes + ausenciasJustificadas) / diasEsperados) * 1000) / 10 : 100;

    return {
      employeeId: emp.id,
      legajo: emp.legajo,
      nombre: `${emp.apellido}, ${emp.nombre}`,
      diasEsperados,
      presentes,
      ausenciasJustificadas,
      ausenciasInjustificadas,
      ausenciasSinClasificar,
      porcentajeAsistencia,
    };
  });

  const totalDiasEsperados = porEmpleado.reduce((a, e) => a + e.diasEsperados, 0);
  const totalPresentesOJustificados = porEmpleado.reduce((a, e) => a + e.presentes + e.ausenciasJustificadas, 0);
  const porcentajeGeneral = totalDiasEsperados > 0 ? Math.round((totalPresentesOJustificados / totalDiasEsperados) * 1000) / 10 : 100;

  return NextResponse.json({ fechaDesde, fechaHasta, porcentajeGeneral, empleados: porEmpleado });
}
