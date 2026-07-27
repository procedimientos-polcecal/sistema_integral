import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularDia, type PayrollConfigLike } from "./calculo";
import { ajustarFichadasPorTurno, intervalsParaDia, type FichadaLike, type TurnoLike } from "./recalcular-puro";
import { addUtcDays, dayOfWeekUtc, utcDateOnlyFrom } from "../dates";
import { SECTORES_LUNES_A_VIERNES } from "../constants";

const startOfDay = utcDateOnlyFrom;

function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  let cur = startOfDay(from);
  const end = startOfDay(to);
  while (cur <= end) {
    days.push(cur);
    cur = addUtcDays(cur, 1);
  }
  return days;
}

function fechaStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getConfigLiquidacion(
  supabase: SupabaseClient
): Promise<
  PayrollConfigLike & {
    horasFrancoCompensatorio: number;
    multiplicadorExtra50: number;
    multiplicadorExtra100: number;
  }
> {
  const { data, error } = await supabase.from("config_liquidacion").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`No se pudo leer config_liquidacion: ${error?.message}`);
  return {
    horasNormalesPorDia: Number(data.horas_normales_por_dia),
    horaCorteSabado: data.hora_corte_sabado,
    feriadoComoDomingo: data.feriado_como_domingo,
    horasFrancoCompensatorio: Number(data.horas_franco_compensatorio),
    multiplicadorExtra50: Number(data.multiplicador_extra_50),
    multiplicadorExtra100: Number(data.multiplicador_extra_100),
  };
}

/**
 * Recalcula `calculos_diarios` para un empleado en un rango de fechas, a
 * partir de sus fichadas, ausencias, vacaciones y feriados vigentes. Misma
 * lógica que el original (`recalcularEmpleadoPeriodo` de gestion-operarios),
 * reescrita contra Supabase en vez de Prisma. Es idempotente.
 */
export async function recalcularEmpleadoPeriodo(
  supabase: SupabaseClient,
  empleadoId: string,
  desde: Date,
  hasta: Date
) {
  const config = await getConfigLiquidacion(supabase);

  const desdeStr = fechaStr(addUtcDays(startOfDay(desde), -1));
  const hastaStr = fechaStr(startOfDay(hasta));

  const [{ data: empleado }, { data: fichadasRaw }, { data: ausencias }, { data: vacaciones }, { data: feriados }, { data: turnosActivos }] =
    await Promise.all([
      supabase.from("empleados").select("sector_id, sectores(nombre)").eq("id", empleadoId).single(),
      supabase.from("fichadas").select("fecha, hora_entrada, hora_salida").eq("empleado_id", empleadoId).gte("fecha", desdeStr).lte("fecha", hastaStr),
      supabase.from("ausencias").select("fecha_desde, fecha_hasta, tipo, justificada").eq("empleado_id", empleadoId).lte("fecha_desde", fechaStr(startOfDay(hasta))).gte("fecha_hasta", fechaStr(startOfDay(desde))),
      supabase.from("vacaciones").select("fecha_desde, fecha_hasta").eq("empleado_id", empleadoId).lte("fecha_desde", fechaStr(startOfDay(hasta))).gte("fecha_hasta", fechaStr(startOfDay(desde))),
      supabase.from("feriados").select("fecha").gte("fecha", desdeStr).lte("fecha", hastaStr),
      supabase.from("jornadas").select("id, hora_inicio, hora_fin, tolerancia_minutos").eq("activo", true),
    ]);

  const sectorNombre = (empleado?.sectores as unknown as { nombre: string } | null)?.nombre ?? null;
  const trabajaLunesAViernesNomas = !!sectorNombre && SECTORES_LUNES_A_VIERNES.includes(sectorNombre);

  const fichadas: FichadaLike[] = (fichadasRaw ?? []).map((f) => ({
    fecha: startOfDay(new Date(f.fecha)),
    horaEntrada: new Date(f.hora_entrada),
    horaSalida: f.hora_salida ? new Date(f.hora_salida) : null,
  }));

  const turnos: TurnoLike[] = (turnosActivos ?? []).map((t) => ({
    id: t.id,
    horaInicio: t.hora_inicio,
    horaFin: t.hora_fin,
    toleranciaMinutos: t.tolerancia_minutos,
  }));

  const { ajustadas: fichadasAjustadas, tardePorDia, retiroAnticipadoPorDia } = ajustarFichadasPorTurno(fichadas, turnos);

  const feriadosSet = new Set((feriados ?? []).map((f) => startOfDay(new Date(f.fecha)).getTime()));

  const { data: existentesRaw } = await supabase
    .from("calculos_diarios")
    .select("fecha, horas_manual, extras_validadas, horas_extra_50, horas_extra_100")
    .eq("empleado_id", empleadoId)
    .gte("fecha", fechaStr(startOfDay(desde)))
    .lte("fecha", fechaStr(startOfDay(hasta)));
  const existentePorFecha = new Map((existentesRaw ?? []).map((e) => [startOfDay(new Date(e.fecha)).getTime(), e]));

  const dias = eachDay(desde, hasta);
  const rows: Record<string, unknown>[] = [];
  const diasConFranco: Date[] = [];

  for (const dia of dias) {
    const key = dia.getTime();
    const existente = existentePorFecha.get(key);
    if (existente?.horas_manual) continue; // corregido a mano por RRHH, no se pisa

    const intervals = intervalsParaDia(dia, fichadasAjustadas);
    const esFeriado = feriadosSet.has(key);
    const calc = calcularDia(dia, intervals, esFeriado, config);

    const dow = dayOfWeekUtc(dia);
    const esDomingoLibre = dow === 0;
    const esSabadoNoLaboral = dow === 6 && trabajaLunesAViernesNomas;

    const fichadasDelDia = fichadas.filter((f) => startOfDay(f.fecha).getTime() === key);
    const tieneFichada = fichadasDelDia.length > 0;
    const tieneFichadaAbierta = fichadasDelDia.some((f) => !f.horaSalida);

    const tarde = tieneFichada && !esDomingoLibre && !esSabadoNoLaboral ? tardePorDia.get(key) ?? false : false;
    const retiroAnticipado = tieneFichada && !esDomingoLibre && !esSabadoNoLaboral ? retiroAnticipadoPorDia.get(key) ?? false : false;

    const vacacion = (vacaciones ?? []).find(
      (v) => startOfDay(new Date(v.fecha_desde)) <= dia && startOfDay(new Date(v.fecha_hasta)) >= dia
    );
    const ausenciaCargada = (ausencias ?? []).find(
      (a) => startOfDay(new Date(a.fecha_desde)) <= dia && startOfDay(new Date(a.fecha_hasta)) >= dia
    );

    let ausente = false;
    let justificada: boolean | null = null;
    let tipoAusencia: string | null = null;
    let observaciones: string | null = null;

    if (!tieneFichada && !esDomingoLibre && !esSabadoNoLaboral) {
      if (vacacion) {
        ausente = false;
      } else if (ausenciaCargada) {
        ausente = true;
        justificada = ausenciaCargada.justificada;
        tipoAusencia = ausenciaCargada.tipo;
      } else if (esFeriado) {
        ausente = false;
      } else {
        ausente = true;
        justificada = null;
        tipoAusencia = null;
      }
    } else if (tieneFichadaAbierta) {
      observaciones = "Fichada sin marcación de salida: revisar y completar manualmente";
    }

    const preservarValidacion =
      existente?.extras_validadas &&
      Number(existente.horas_extra_50) === calc.horasExtra50 &&
      Number(existente.horas_extra_100) === calc.horasExtra100;

    if (calc.francoGenerado) diasConFranco.push(dia);

    rows.push({
      empleado_id: empleadoId,
      fecha: fechaStr(dia),
      tipo_dia: calc.tipoDia,
      horas_normales: calc.horasNormales,
      horas_extra_50: calc.horasExtra50,
      horas_extra_100: calc.horasExtra100,
      franco_generado: calc.francoGenerado,
      ausente,
      justificada,
      tipo_ausencia: tipoAusencia,
      observaciones,
      tarde,
      retiro_anticipado: retiroAnticipado,
      ...(preservarValidacion ? {} : { extras_validadas: false, validado_por_id: null, fecha_validacion: null }),
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("calculos_diarios").upsert(rows, { onConflict: "empleado_id,fecha" });
    if (error) throw new Error(`Recalculando calculos_diarios: ${error.message}`);
  }

  // Genera francos compensatorios para los días que corresponda y que
  // todavía no tengan uno generado (idempotente).
  for (const dia of diasConFranco) {
    const fecha = fechaStr(dia);
    const { data: existenteFranco } = await supabase
      .from("francos")
      .select("id")
      .eq("empleado_id", empleadoId)
      .eq("fecha_generado", fecha)
      .maybeSingle();
    if (!existenteFranco) {
      await supabase.from("francos").insert({
        empleado_id: empleadoId,
        fecha_generado: fecha,
        horas: config.horasFrancoCompensatorio,
      });
    }
  }

  return rows.length;
}

/**
 * Recalcula todos los empleados activos de un sector (o todos si
 * `sectorId` es null), en lotes concurrentes.
 */
export async function recalcularSectorPeriodo(
  supabase: SupabaseClient,
  sectorId: string | null,
  desde: Date,
  hasta: Date
) {
  let query = supabase.from("empleados").select("id").eq("activo", true);
  if (sectorId) query = query.eq("sector_id", sectorId);
  const { data: empleados } = await query;

  const LOTE = 8;
  const lista = empleados ?? [];
  for (let i = 0; i < lista.length; i += LOTE) {
    await Promise.all(lista.slice(i, i + LOTE).map((e) => recalcularEmpleadoPeriodo(supabase, e.id, desde, hasta)));
  }
  return lista.length;
}
