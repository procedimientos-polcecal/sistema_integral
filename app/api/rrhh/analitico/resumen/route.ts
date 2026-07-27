import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { idsOrDummy } from "@/lib/rrhh/dashboardHelpers";
import { recalcularPeriodoCacheado } from "@/lib/rrhh/recalcCache";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";
import { SECTORES_LUNES_A_VIERNES } from "@/lib/rrhh/constants";

const MS_POR_ANIO = 365.25 * 86_400_000;
function edadEnAnios(desde: Date, hasta: Date): number {
  return (hasta.getTime() - desde.getTime()) / MS_POR_ANIO;
}
function esDiaEsperado(tipoDia: string, trabajaLunesAViernesNomas: boolean): boolean {
  return tipoDia !== "DOMINGO" && !(trabajaLunesAViernesNomas && tipoDia === "SABADO");
}

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, sector_id, fecha_ingreso, sectores(nombre), rrhh_empleados_datos(fecha_nacimiento)")
    .eq("activo", true);
  const lista = empleados ?? [];
  const empleadoIds = lista.map((e) => e.id);
  const empleadoById = new Map(lista.map((e) => [e.id, e]));

  const hoy = utcDateOnlyFrom(new Date());
  const desde = utcDateOnlyFrom(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)));

  await recalcularPeriodoCacheado(supabase, desde, hoy);

  const [{ data: calculos }, { data: tardanzasManuales }] = await Promise.all([
    supabase
      .from("calculos_diarios")
      .select("empleado_id, fecha, tipo_dia, ausente, tarde")
      .in("empleado_id", idsOrDummy(empleadoIds))
      .gte("fecha", desde.toISOString().slice(0, 10))
      .lte("fecha", hoy.toISOString().slice(0, 10)),
    supabase
      .from("ausencias")
      .select("empleado_id, fecha_desde")
      .in("empleado_id", idsOrDummy(empleadoIds))
      .eq("tipo", "TARDANZA")
      .gte("fecha_desde", desde.toISOString().slice(0, 10))
      .lte("fecha_desde", hoy.toISOString().slice(0, 10)),
  ]);

  const tardeSet = new Set<string>();
  for (const c of calculos ?? []) if (c.tarde) tardeSet.add(`${c.empleado_id}|${c.fecha}`);
  for (const a of tardanzasManuales ?? []) tardeSet.add(`${a.empleado_id}|${a.fecha_desde}`);

  let diasEsperados = 0;
  let diasAusentes = 0;
  for (const c of calculos ?? []) {
    const emp = empleadoById.get(c.empleado_id);
    const sectorNombre = (emp?.sectores as unknown as { nombre: string } | null)?.nombre ?? null;
    const trabajaLunesAViernesNomas = !!sectorNombre && SECTORES_LUNES_A_VIERNES.includes(sectorNombre);
    if (esDiaEsperado(c.tipo_dia, trabajaLunesAViernesNomas)) {
      diasEsperados += 1;
      if (c.ausente) diasAusentes += 1;
    }
  }
  const diasTarde = tardeSet.size;

  const conFechaNacimiento = lista.filter(
    (e) => (e.rrhh_empleados_datos as unknown as { fecha_nacimiento: string | null } | null)?.fecha_nacimiento
  );
  const promedioEdad =
    conFechaNacimiento.length > 0
      ? Math.round(
          (conFechaNacimiento.reduce(
            (a, e) =>
              a +
              edadEnAnios(
                new Date((e.rrhh_empleados_datos as unknown as { fecha_nacimiento: string }).fecha_nacimiento),
                hoy
              ),
            0
          ) /
            conFechaNacimiento.length) *
            10
        ) / 10
      : null;
  const promedioAntiguedad =
    lista.length > 0
      ? Math.round((lista.reduce((a, e) => a + edadEnAnios(new Date(e.fecha_ingreso), hoy), 0) / lista.length) * 10) / 10
      : 0;

  return NextResponse.json({
    cantidadEmpleados: lista.length,
    ausentismo: diasEsperados > 0 ? Math.round((diasAusentes / diasEsperados) * 1000) / 10 : 0,
    tardanza: diasEsperados > 0 ? Math.round((diasTarde / diasEsperados) * 1000) / 10 : 0,
    promedioEdad,
    promedioAntiguedad,
  });
}
