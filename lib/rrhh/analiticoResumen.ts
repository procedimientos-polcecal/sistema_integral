import type { SupabaseClient } from "@supabase/supabase-js";
import { idsOrDummy } from "./dashboardHelpers";
import { utcDateOnlyFrom } from "./dates";
import { SECTORES_LUNES_A_VIERNES } from "./constants";
import { traerPaginado } from "./paginado";

export interface ResumenAnalitico {
  cantidadEmpleados: number;
  ausentismo: number;
  tardanza: number;
  promedioEdad: number | null;
  promedioAntiguedad: number;
}

const MS_POR_ANIO = 365.25 * 86_400_000;

function edadEnAnios(desde: Date, hasta: Date): number {
  return (hasta.getTime() - desde.getTime()) / MS_POR_ANIO;
}

function esDiaEsperado(tipoDia: string, trabajaLunesAViernesNomas: boolean): boolean {
  return tipoDia !== "DOMINGO" && !(trabajaLunesAViernesNomas && tipoDia === "SABADO");
}

/**
 * Las cinco tarjetas del Analítico: cantidad de empleados, ausentismo y
 * tardanza del mes en curso, y los promedios de edad y antigüedad.
 *
 * Vive acá y no dentro de la ruta de API para que la pueda llamar también el
 * Server Component de la pantalla, y así los cinco números lleguen en el HTML
 * en vez de aparecer como "-" hasta que el navegador hidrate y haga el fetch.
 * La ruta sigue existiendo para cuando haga falta refrescarlos sin recargar.
 */
export async function calcularResumenAnalitico(supabase: SupabaseClient): Promise<ResumenAnalitico> {
  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, sector_id, fecha_ingreso, sectores(nombre), rrhh_empleados_datos(fecha_nacimiento)")
    .eq("activo", true);
  const lista = empleados ?? [];
  const empleadoIds = idsOrDummy(lista.map((e) => e.id));
  const empleadoById = new Map(lista.map((e) => [e.id, e]));

  const hoy = utcDateOnlyFrom(new Date());
  const desde = utcDateOnlyFrom(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)));
  const desdeStr = desde.toISOString().slice(0, 10);
  const hoyStr = hoy.toISOString().slice(0, 10);

  const [calculos, tardanzasManuales] = await Promise.all([
    traerPaginado<{ empleado_id: string; fecha: string; tipo_dia: string; ausente: boolean; tarde: boolean }>(
      () =>
        supabase
          .from("calculos_diarios")
          .select("empleado_id, fecha, tipo_dia, ausente, tarde")
          .in("empleado_id", empleadoIds)
          .gte("fecha", desdeStr)
          .lte("fecha", hoyStr)
          .order("id"),
      "resumen analítico"
    ),
    traerPaginado<{ empleado_id: string; fecha_desde: string }>(
      () =>
        supabase
          .from("ausencias")
          .select("empleado_id, fecha_desde")
          .in("empleado_id", empleadoIds)
          .eq("tipo", "TARDANZA")
          .gte("fecha_desde", desdeStr)
          .lte("fecha_desde", hoyStr)
          .order("id"),
      "tardanzas cargadas a mano"
    ),
  ]);

  // Un día puede figurar tarde por el reloj y además tener una tardanza cargada
  // a mano: se cuenta una vez.
  const tardeSet = new Set<string>();
  for (const c of calculos) if (c.tarde) tardeSet.add(`${c.empleado_id}|${c.fecha}`);
  for (const a of tardanzasManuales) tardeSet.add(`${a.empleado_id}|${a.fecha_desde}`);

  let diasEsperados = 0;
  let diasAusentes = 0;
  for (const c of calculos) {
    const emp = empleadoById.get(c.empleado_id);
    const sectorNombre = (emp?.sectores as unknown as { nombre: string } | null)?.nombre ?? null;
    const trabajaLunesAViernesNomas = !!sectorNombre && SECTORES_LUNES_A_VIERNES.includes(sectorNombre);
    if (esDiaEsperado(c.tipo_dia, trabajaLunesAViernesNomas)) {
      diasEsperados += 1;
      if (c.ausente) diasAusentes += 1;
    }
  }

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

  const porcentaje = (n: number) => (diasEsperados > 0 ? Math.round((n / diasEsperados) * 1000) / 10 : 0);

  return {
    cantidadEmpleados: lista.length,
    ausentismo: porcentaje(diasAusentes),
    tardanza: porcentaje(tardeSet.size),
    promedioEdad,
    promedioAntiguedad,
  };
}
