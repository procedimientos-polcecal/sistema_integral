import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { recalcularSectorPeriodo } from "@/lib/rrhh/engine/recalcular";
import { SECTORES_LUNES_A_VIERNES } from "@/lib/rrhh/constants";
import { dayOfWeekUtc, utcDateOnlyFrom } from "@/lib/rrhh/dates";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const sectorId = url.searchParams.get("sectorId");
  const fechaParam = url.searchParams.get("fecha");
  const dia = utcDateOnlyFrom(fechaParam ? new Date(fechaParam) : new Date());
  const diaStr = dia.toISOString().slice(0, 10);

  await recalcularSectorPeriodo(supabase, sectorId || null, dia, dia);

  let query = supabase
    .from("empleados")
    .select("id, legajo, nombre, apellido, sector_id, sectores(nombre)")
    .eq("activo", true)
    .order("apellido")
    .order("nombre");
  if (sectorId) query = query.eq("sector_id", sectorId);
  const { data: empleados } = await query;

  const empleadoIds = (empleados ?? []).map((e) => e.id);
  const idsOrDummy = empleadoIds.length > 0 ? empleadoIds : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: calculos }, { data: fichadas }] = await Promise.all([
    supabase.from("calculos_diarios").select("*").in("empleado_id", idsOrDummy).eq("fecha", diaStr),
    supabase.from("fichadas").select("*").in("empleado_id", idsOrDummy).eq("fecha", diaStr),
  ]);

  const porEmpleado = new Map((calculos ?? []).map((c) => [c.empleado_id, c]));
  const fichadasPorEmpleado = new Map<string, typeof fichadas>();
  for (const f of fichadas ?? []) {
    if (!fichadasPorEmpleado.has(f.empleado_id)) fichadasPorEmpleado.set(f.empleado_id, []);
    fichadasPorEmpleado.get(f.empleado_id)!.push(f);
  }

  const dow = dayOfWeekUtc(dia);

  const roster = (empleados ?? [])
    .map((emp) => {
      const c = porEmpleado.get(emp.id);
      const horasTrabajadas = c ? Number(c.horas_normales) + Number(c.horas_extra_50) + Number(c.horas_extra_100) : 0;
      const sectorNombre = (emp.sectores as unknown as { nombre: string } | null)?.nombre ?? null;
      const trabajaLunesAViernesNomas = !!sectorNombre && SECTORES_LUNES_A_VIERNES.includes(sectorNombre);
      const esDiaNoLaboral = dow === 0 || (dow === 6 && trabajaLunesAViernesNomas);
      const fichadasDelDia = fichadasPorEmpleado.get(emp.id) ?? [];
      return {
        employeeId: emp.id,
        legajo: emp.legajo,
        nombre: `${emp.apellido}, ${emp.nombre}`,
        sectorId: emp.sector_id,
        tipoDia: c?.tipo_dia ?? null,
        horasNormales: c ? Number(c.horas_normales) : 0,
        horasExtra50: c ? Number(c.horas_extra_50) : 0,
        horasExtra100: c ? Number(c.horas_extra_100) : 0,
        horasManual: c?.horas_manual ?? false,
        horasTrabajadas,
        ausente: c?.ausente ?? false,
        justificada: c?.justificada ?? null,
        tipoAusencia: c?.tipo_ausencia ?? null,
        observaciones: c?.observaciones ?? null,
        fichadas: fichadasDelDia,
        esDiaNoLaboral,
      };
    })
    .filter((r) => !r.esDiaNoLaboral || r.horasTrabajadas > 0 || r.fichadas.length > 0);

  return NextResponse.json({ fecha: diaStr, empleados: roster });
}
