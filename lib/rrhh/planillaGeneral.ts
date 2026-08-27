import type { SupabaseClient } from "@supabase/supabase-js";
import { recalcularSectorPeriodo, getConfigLiquidacion } from "./engine/recalcular";
import { determinarTipoDia } from "./engine/calculo";
import { addUtcDays, utcDateOnlyFrom } from "./dates";

export type ModalidadPago = "JORNAL" | "MENSUAL";

export interface FilaPlanilla {
  empleadoId: string;
  nombre: string;
  legajo: string;
  modalidadPago: ModalidadPago;
  horasNormales: number;
  horasExtra50: number;
  horasExtra100: number;
  horasFranco: number;
  horasVacaciones: number;
  horasEnfermedad: number;
  montoNormal: number;
  montoExtra50: number;
  montoExtra100: number;
  montoFranco: number;
  montoTotal: number;
}

function dia(fecha: string): Date {
  return new Date(`${fecha.slice(0, 10)}T00:00:00Z`);
}

/** Días calendario en que [aDesde, aHasta] se superpone con [bDesde, bHasta] (0 si no se superponen). */
function diasSuperpuestos(aDesde: Date, aHasta: Date, bDesde: Date, bHasta: Date): number {
  const inicio = aDesde > bDesde ? aDesde : bDesde;
  const fin = aHasta < bHasta ? aHasta : bHasta;
  if (fin < inicio) return 0;
  return Math.round((fin.getTime() - inicio.getTime()) / 86_400_000) + 1;
}

/**
 * Días hábiles o sábado (no domingo, no feriado) en que [aDesde, aHasta] se
 * superpone con [bDesde, bHasta]. Se usa para enfermedad (licencia médica):
 * domingos y feriados no suman horas, sin importar cuánto dure la licencia.
 */
function diasHabilesSuperpuestos(aDesde: Date, aHasta: Date, bDesde: Date, bHasta: Date, feriados: Set<number>): number {
  const inicio = aDesde > bDesde ? aDesde : bDesde;
  const fin = aHasta < bHasta ? aHasta : bHasta;
  if (fin < inicio) return 0;
  let cantidad = 0;
  for (let d = utcDateOnlyFrom(inicio); d <= fin; d = addUtcDays(d, 1)) {
    const tipoDia = determinarTipoDia(d, feriados.has(d.getTime()));
    if (tipoDia === "HABIL" || tipoDia === "SABADO") cantidad++;
  }
  return cantidad;
}

function agruparPorEmpleado<T extends { empleado_id: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const arr = map.get(item.empleado_id) ?? [];
    arr.push(item);
    map.set(item.empleado_id, arr);
  }
  return map;
}

/**
 * Planilla general: resumen de horas y montos de todo el personal activo para
 * un período, incluyendo las horas de vacaciones y de enfermedad (días
 * superpuestos con el período × horas teóricas diarias del empleado, ya que
 * esos días no generan horas normales trabajadas en el cálculo diario). Se
 * usa tanto para mostrarla en pantalla como para exportarla a Excel.
 *
 * Recalcula todo el personal en lotes concurrentes y trae los datos del
 * período en un puñado de consultas para todos los empleados a la vez, en vez
 * de repetir varias consultas por cada uno: con ~70 empleados, hacerlo
 * secuencial tardaba minutos.
 */
export async function calcularPlanillaGeneral(
  supabase: SupabaseClient,
  desde: string,
  hasta: string,
  modalidadPago?: ModalidadPago
): Promise<FilaPlanilla[]> {
  const fechaDesde = dia(desde);
  const fechaHasta = dia(hasta);

  let queryEmpleados = supabase
    .from("empleados")
    .select("id, legajo, nombre, apellido, valor_hora_normal, horas_teoricas_diarias, modalidad_pago")
    .eq("activo", true)
    .order("apellido")
    .order("nombre");
  if (modalidadPago) queryEmpleados = queryEmpleados.eq("modalidad_pago", modalidadPago);

  const { data: empleados } = await queryEmpleados;
  const config = await getConfigLiquidacion(supabase);

  await recalcularSectorPeriodo(supabase, null, fechaDesde, fechaHasta);

  const [{ data: todosDias }, { data: todosFrancos }, { data: todasVacaciones }, { data: todasEnfermedad }, { data: feriados }] =
    await Promise.all([
      supabase
        .from("calculos_diarios")
        .select("empleado_id, horas_normales, horas_extra_50, horas_extra_100, extras_validadas")
        .gte("fecha", desde)
        .lte("fecha", hasta),
      supabase.from("francos").select("empleado_id, horas").gte("fecha_generado", desde).lte("fecha_generado", hasta),
      supabase.from("vacaciones").select("empleado_id, fecha_desde, fecha_hasta").lte("fecha_desde", hasta).gte("fecha_hasta", desde),
      supabase
        .from("ausencias")
        .select("empleado_id, fecha_desde, fecha_hasta")
        .eq("tipo", "ENFERMEDAD_ACCIDENTE_INCULPABLE")
        .eq("justificada", true)
        .lte("fecha_desde", hasta)
        .gte("fecha_hasta", desde),
      supabase.from("feriados").select("fecha").gte("fecha", desde).lte("fecha", hasta),
    ]);

  const diasPorEmpleado = agruparPorEmpleado(todosDias ?? []);
  const francosPorEmpleado = agruparPorEmpleado(todosFrancos ?? []);
  const vacacionesPorEmpleado = agruparPorEmpleado(todasVacaciones ?? []);
  const enfermedadPorEmpleado = agruparPorEmpleado(todasEnfermedad ?? []);
  const feriadosSet = new Set((feriados ?? []).map((f) => dia(f.fecha).getTime()));

  return (empleados ?? []).map((empleado) => {
    const dias = diasPorEmpleado.get(empleado.id) ?? [];
    const francos = francosPorEmpleado.get(empleado.id) ?? [];
    const vacaciones = vacacionesPorEmpleado.get(empleado.id) ?? [];
    const enfermedad = enfermedadPorEmpleado.get(empleado.id) ?? [];

    const horasNormales = dias.reduce((a, d) => a + Number(d.horas_normales), 0);
    const diasValidados = dias.filter((d) => d.extras_validadas);
    const horasExtra50 = diasValidados.reduce((a, d) => a + Number(d.horas_extra_50), 0);
    const horasExtra100 = diasValidados.reduce((a, d) => a + Number(d.horas_extra_100), 0);
    const horasFranco = francos.reduce((a, f) => a + Number(f.horas), 0);

    const horasTeoricas = Number(empleado.horas_teoricas_diarias);
    const diasVacaciones = vacaciones.reduce(
      (a, v) => a + diasSuperpuestos(dia(v.fecha_desde), dia(v.fecha_hasta), fechaDesde, fechaHasta),
      0
    );
    const diasEnfermedad = enfermedad.reduce(
      (a, e) => a + diasHabilesSuperpuestos(dia(e.fecha_desde), dia(e.fecha_hasta), fechaDesde, fechaHasta, feriadosSet),
      0
    );

    const valorHora = Number(empleado.valor_hora_normal);
    const montoNormal = horasNormales * valorHora;
    const montoExtra50 = horasExtra50 * valorHora * config.multiplicadorExtra50;
    const montoExtra100 = horasExtra100 * valorHora * config.multiplicadorExtra100;
    const montoFranco = horasFranco * valorHora;

    const un = (n: number) => Math.round(n * 10) / 10;
    return {
      empleadoId: empleado.id,
      nombre: `${empleado.apellido}, ${empleado.nombre}`,
      legajo: empleado.legajo,
      modalidadPago: (empleado.modalidad_pago ?? "JORNAL") as ModalidadPago,
      horasNormales: un(horasNormales),
      horasExtra50: un(horasExtra50),
      horasExtra100: un(horasExtra100),
      horasFranco: un(horasFranco),
      horasVacaciones: un(diasVacaciones * horasTeoricas),
      horasEnfermedad: un(diasEnfermedad * horasTeoricas),
      montoNormal: Math.round(montoNormal),
      montoExtra50: Math.round(montoExtra50),
      montoExtra100: Math.round(montoExtra100),
      montoFranco: Math.round(montoFranco),
      montoTotal: Math.round(montoNormal + montoExtra50 + montoExtra100 + montoFranco),
    };
  });
}

export function parseModalidad(v: string | null): ModalidadPago | undefined {
  return v === "JORNAL" || v === "MENSUAL" ? v : undefined;
}
