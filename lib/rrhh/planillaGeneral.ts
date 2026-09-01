import type { SupabaseClient } from "@supabase/supabase-js";
import { recalcularSectorPeriodo, getConfigLiquidacion } from "./engine/recalcular";
import { determinarTipoDia } from "./engine/calculo";
import { addUtcDays, utcDateOnlyFrom } from "./dates";
import { traerPaginado } from "./paginado";

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
  /**
   * Lo que el motor calculó como extra y todavía nadie validó. No está sumado
   * en las columnas de arriba: va aparte, para poder avisarlo.
   */
  diasSinValidar: number;
  horasExtra50SinValidar: number;
  horasExtra100SinValidar: number;
}

/** Un día del motor de cálculo, de lo que la planilla necesita leer. */
export interface DiaCalculado {
  empleado_id: string;
  horas_normales: number;
  horas_extra_50: number;
  horas_extra_100: number;
  extras_validadas: boolean;
}

/**
 * Las horas extra que el motor calculó y todavía nadie validó.
 *
 * La planilla suma las extra sólo de los días validados: una hora extra se paga
 * cuando alguien la aprobó, no porque el reloj la haya registrado. Pero mostrar
 * 0 y nada más se lee igual que "no hizo extras", y son cosas distintas. Esto
 * es lo que quedó afuera, para poder decirlo.
 *
 * Un día sin validar y sin extras no cuenta: es el caso normal —casi ningún día
 * tiene extras y nadie los valida—, y contarlo convertiría el aviso en ruido.
 */
export function extrasSinValidar(dias: DiaCalculado[]): {
  dias: number;
  horas50: number;
  horas100: number;
} {
  const pendientes = dias.filter(
    (d) => !d.extras_validadas && (Number(d.horas_extra_50) > 0 || Number(d.horas_extra_100) > 0)
  );
  return {
    dias: pendientes.length,
    horas50: pendientes.reduce((a, d) => a + Number(d.horas_extra_50), 0),
    horas100: pendientes.reduce((a, d) => a + Number(d.horas_extra_100), 0),
  };
}

export function dia(fecha: string): Date {
  return new Date(`${fecha.slice(0, 10)}T00:00:00Z`);
}

/** Días calendario en que [aDesde, aHasta] se superpone con [bDesde, bHasta] (0 si no se superponen). */
export function diasSuperpuestos(aDesde: Date, aHasta: Date, bDesde: Date, bHasta: Date): number {
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
export function diasHabilesSuperpuestos(aDesde: Date, aHasta: Date, bDesde: Date, bHasta: Date, feriados: Set<number>): number {
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

  // Todo se lee paginado: un mes de calculos_diarios del padron entero pasa las
  // 1000 filas que devuelve PostgREST, y una planilla de sueldos calculada
  // sobre la mitad de los dias no se nota hasta que alguien reclama el recibo.
  const empleados = await traerPaginado<{
    id: string;
    legajo: string;
    nombre: string;
    apellido: string;
    valor_hora_normal: number;
    horas_teoricas_diarias: number;
    modalidad_pago: string | null;
  }>(() => {
    let q = supabase
      .from("empleados")
      .select("id, legajo, nombre, apellido, valor_hora_normal, horas_teoricas_diarias, modalidad_pago")
      .eq("activo", true)
      .order("apellido")
      .order("nombre")
      .order("id");
    if (modalidadPago) q = q.eq("modalidad_pago", modalidadPago);
    return q;
  }, "empleados de la planilla");
  const config = await getConfigLiquidacion(supabase);

  await recalcularSectorPeriodo(supabase, null, fechaDesde, fechaHasta);

  const [todosDias, todosFrancos, todasVacaciones, todasEnfermedad, feriados] = await Promise.all([
    traerPaginado<DiaCalculado>(
      () =>
        supabase
          .from("calculos_diarios")
          .select("empleado_id, horas_normales, horas_extra_50, horas_extra_100, extras_validadas")
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("id"),
      "calculos diarios de la planilla"
    ),
    traerPaginado<{ empleado_id: string; horas: number }>(
      () => supabase.from("francos").select("empleado_id, horas").gte("fecha_generado", desde).lte("fecha_generado", hasta).order("id"),
      "francos de la planilla"
    ),
    traerPaginado<{ empleado_id: string; fecha_desde: string; fecha_hasta: string }>(
      () =>
        supabase
          .from("vacaciones")
          .select("empleado_id, fecha_desde, fecha_hasta")
          .lte("fecha_desde", hasta)
          .gte("fecha_hasta", desde)
          .order("id"),
      "vacaciones de la planilla"
    ),
    traerPaginado<{ empleado_id: string; fecha_desde: string; fecha_hasta: string }>(
      () =>
        supabase
          .from("ausencias")
          .select("empleado_id, fecha_desde, fecha_hasta")
          .eq("tipo", "ENFERMEDAD_ACCIDENTE_INCULPABLE")
          .eq("justificada", true)
          .lte("fecha_desde", hasta)
          .gte("fecha_hasta", desde)
          .order("id"),
      "enfermedad de la planilla"
    ),
    traerPaginado<{ fecha: string }>(
      () => supabase.from("feriados").select("fecha").gte("fecha", desde).lte("fecha", hasta).order("id"),
      "feriados de la planilla"
    ),
  ]);

  const diasPorEmpleado = agruparPorEmpleado(todosDias);
  const francosPorEmpleado = agruparPorEmpleado(todosFrancos);
  const vacacionesPorEmpleado = agruparPorEmpleado(todasVacaciones);
  const enfermedadPorEmpleado = agruparPorEmpleado(todasEnfermedad);
  const feriadosSet = new Set(feriados.map((f) => dia(f.fecha).getTime()));

  return empleados.map((empleado) => {
    const dias = diasPorEmpleado.get(empleado.id) ?? [];
    const francos = francosPorEmpleado.get(empleado.id) ?? [];
    const vacaciones = vacacionesPorEmpleado.get(empleado.id) ?? [];
    const enfermedad = enfermedadPorEmpleado.get(empleado.id) ?? [];

    const horasNormales = dias.reduce((a, d) => a + Number(d.horas_normales), 0);
    const diasValidados = dias.filter((d) => d.extras_validadas);
    const horasExtra50 = diasValidados.reduce((a, d) => a + Number(d.horas_extra_50), 0);
    const horasExtra100 = diasValidados.reduce((a, d) => a + Number(d.horas_extra_100), 0);
    const pendientes = extrasSinValidar(dias);
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
      diasSinValidar: pendientes.dias,
      horasExtra50SinValidar: un(pendientes.horas50),
      horasExtra100SinValidar: un(pendientes.horas100),
    };
  });
}

export function parseModalidad(v: string | null): ModalidadPago | undefined {
  return v === "JORNAL" || v === "MENSUAL" ? v : undefined;
}
