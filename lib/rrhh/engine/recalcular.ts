import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularDia, type PayrollConfigLike } from "./calculo";
import { ajustarFichadasPorTurno, intervalsParaDia, type FichadaLike, type TurnoLike } from "./recalcular-puro";
import { addUtcDays, dayOfWeekUtc, utcDateOnlyFrom } from "../dates";
import { SECTORES_LUNES_A_VIERNES } from "../constants";
import { traerPaginado } from "../paginado";

const startOfDay = utcDateOnlyFrom;

/**
 * De cuántos empleados se traen los datos por vuelta. Acota el largo de la URL
 * de los `.in(...)` y el uso de memoria; con el padrón actual (~70) entra todo
 * en una sola vuelta.
 */
const LOTE_EMPLEADOS = 100;

/** Filas por `upsert`, para no armar un request gigante. */
const LOTE_UPSERT = 500;

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

function agrupar<T>(items: T[], clave: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = clave(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export type ConfigLiquidacion = PayrollConfigLike & {
  horasFrancoCompensatorio: number;
  multiplicadorExtra50: number;
  multiplicadorExtra100: number;
};

export async function getConfigLiquidacion(supabase: SupabaseClient): Promise<ConfigLiquidacion> {
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
 * Recalcula `calculos_diarios` para una lista de empleados en un rango de
 * fechas, a partir de sus fichadas, ausencias, vacaciones y feriados vigentes.
 * Es idempotente: los días corregidos a mano (`horas_manual`) no se pisan.
 *
 * Trae los datos de TODOS los empleados del lote en un puñado de consultas y
 * agrupa en memoria, en vez de repetir nueve consultas por empleado. La
 * configuración, los feriados y el catálogo de turnos son los mismos para todo
 * el padrón, así que se leen una sola vez. Recalcular el padrón completo pasó
 * de ~640 consultas a ~10.
 */
async function recalcularLote(
  supabase: SupabaseClient,
  empleadoIds: string[],
  desde: Date,
  hasta: Date
): Promise<number> {
  if (empleadoIds.length === 0) return 0;

  // Las fichadas se leen desde un día antes: un turno que arrancó la noche
  // anterior aporta horas al primer día del rango.
  const desdeStr = fechaStr(addUtcDays(startOfDay(desde), -1));
  const hastaStr = fechaStr(startOfDay(hasta));
  const desdeDia = fechaStr(startOfDay(desde));
  const dias = eachDay(desde, hasta);

  const [config, { data: feriados }, { data: turnosActivos }] = await Promise.all([
    getConfigLiquidacion(supabase),
    supabase.from("feriados").select("fecha").gte("fecha", desdeStr).lte("fecha", hastaStr),
    supabase.from("jornadas").select("id, hora_inicio, hora_fin, tolerancia_minutos").eq("activo", true),
  ]);

  const feriadosSet = new Set((feriados ?? []).map((f) => startOfDay(new Date(f.fecha)).getTime()));
  const turnos: TurnoLike[] = (turnosActivos ?? []).map((t) => ({
    id: t.id,
    horaInicio: t.hora_inicio,
    horaFin: t.hora_fin,
    toleranciaMinutos: t.tolerancia_minutos,
  }));

  let filasEscritas = 0;

  for (let i = 0; i < empleadoIds.length; i += LOTE_EMPLEADOS) {
    const ids = empleadoIds.slice(i, i + LOTE_EMPLEADOS);

    const [empleados, fichadasRaw, ausencias, vacaciones, existentesRaw] = await Promise.all([
      traerPaginado<{ id: string; sector_id: string | null; sectores: unknown }>(() =>
        supabase.from("empleados").select("id, sector_id, sectores(nombre)").in("id", ids).order("id")
      ),
      traerPaginado<{ empleado_id: string; fecha: string; hora_entrada: string; hora_salida: string | null }>(() =>
        supabase
          .from("fichadas")
          .select("empleado_id, fecha, hora_entrada, hora_salida")
          .in("empleado_id", ids)
          .gte("fecha", desdeStr)
          .lte("fecha", hastaStr)
          .order("id")
      ),
      traerPaginado<{ empleado_id: string; fecha_desde: string; fecha_hasta: string; tipo: string; justificada: boolean }>(() =>
        supabase
          .from("ausencias")
          .select("empleado_id, fecha_desde, fecha_hasta, tipo, justificada")
          .in("empleado_id", ids)
          .lte("fecha_desde", hastaStr)
          .gte("fecha_hasta", desdeDia)
          .order("id")
      ),
      traerPaginado<{ empleado_id: string; fecha_desde: string; fecha_hasta: string }>(() =>
        supabase
          .from("vacaciones")
          .select("empleado_id, fecha_desde, fecha_hasta")
          .in("empleado_id", ids)
          .lte("fecha_desde", hastaStr)
          .gte("fecha_hasta", desdeDia)
          .order("id")
      ),
      traerPaginado<{
        empleado_id: string;
        fecha: string;
        horas_manual: boolean;
        extras_validadas: boolean;
        horas_extra_50: number;
        horas_extra_100: number;
      }>(() =>
        supabase
          .from("calculos_diarios")
          .select("empleado_id, fecha, horas_manual, extras_validadas, horas_extra_50, horas_extra_100")
          .in("empleado_id", ids)
          .gte("fecha", desdeDia)
          .lte("fecha", hastaStr)
          .order("id")
      ),
    ]);

    const sectorPorEmpleado = new Map<string, string | null>(
      empleados.map((e) => [e.id, (e.sectores as { nombre: string } | null)?.nombre ?? null])
    );
    const fichadasPorEmpleado = agrupar(fichadasRaw, (f) => f.empleado_id);
    const ausenciasPorEmpleado = agrupar(ausencias, (a) => a.empleado_id);
    const vacacionesPorEmpleado = agrupar(vacaciones, (v) => v.empleado_id);
    const existentePorClave = new Map(
      existentesRaw.map((e) => [`${e.empleado_id}|${startOfDay(new Date(e.fecha)).getTime()}`, e])
    );

    const rows: Record<string, unknown>[] = [];
    const francosAGenerar: { empleado_id: string; fecha: string }[] = [];

    for (const empleadoId of ids) {
      const sectorNombre = sectorPorEmpleado.get(empleadoId) ?? null;
      const trabajaLunesAViernesNomas = !!sectorNombre && SECTORES_LUNES_A_VIERNES.includes(sectorNombre);

      const fichadas: FichadaLike[] = (fichadasPorEmpleado.get(empleadoId) ?? []).map((f) => ({
        fecha: startOfDay(new Date(f.fecha)),
        horaEntrada: new Date(f.hora_entrada),
        horaSalida: f.hora_salida ? new Date(f.hora_salida) : null,
      }));
      const ausenciasEmp = ausenciasPorEmpleado.get(empleadoId) ?? [];
      const vacacionesEmp = vacacionesPorEmpleado.get(empleadoId) ?? [];

      const { ajustadas: fichadasAjustadas, tardePorDia, retiroAnticipadoPorDia } = ajustarFichadasPorTurno(fichadas, turnos);

      for (const dia of dias) {
        const key = dia.getTime();
        const existente = existentePorClave.get(`${empleadoId}|${key}`);
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
        const retiroAnticipado =
          tieneFichada && !esDomingoLibre && !esSabadoNoLaboral ? retiroAnticipadoPorDia.get(key) ?? false : false;

        const vacacion = vacacionesEmp.find(
          (v) => startOfDay(new Date(v.fecha_desde)) <= dia && startOfDay(new Date(v.fecha_hasta)) >= dia
        );
        const ausenciaCargada = ausenciasEmp.find(
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

        if (calc.francoGenerado) francosAGenerar.push({ empleado_id: empleadoId, fecha: fechaStr(dia) });

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
    }

    for (let j = 0; j < rows.length; j += LOTE_UPSERT) {
      const { error } = await supabase
        .from("calculos_diarios")
        .upsert(rows.slice(j, j + LOTE_UPSERT), { onConflict: "empleado_id,fecha" });
      if (error) throw new Error(`Recalculando calculos_diarios: ${error.message}`);
    }
    filasEscritas += rows.length;

    // Genera los francos compensatorios que falten, en dos consultas para todo
    // el lote en vez de dos por día con franco (idempotente).
    if (francosAGenerar.length > 0) {
      const fechas = [...new Set(francosAGenerar.map((f) => f.fecha))].sort();
      const existentesFranco = await traerPaginado<{ empleado_id: string; fecha_generado: string }>(() =>
        supabase
          .from("francos")
          .select("empleado_id, fecha_generado")
          .in("empleado_id", ids)
          .gte("fecha_generado", fechas[0])
          .lte("fecha_generado", fechas[fechas.length - 1])
          .order("id")
      );
      const yaTiene = new Set(
        existentesFranco.map((f) => `${f.empleado_id}|${fechaStr(startOfDay(new Date(f.fecha_generado)))}`)
      );
      const nuevos = francosAGenerar
        .filter((f) => !yaTiene.has(`${f.empleado_id}|${f.fecha}`))
        .map((f) => ({ empleado_id: f.empleado_id, fecha_generado: f.fecha, horas: config.horasFrancoCompensatorio }));
      if (nuevos.length > 0) {
        const { error } = await supabase.from("francos").insert(nuevos);
        if (error) throw new Error(`Generando francos compensatorios: ${error.message}`);
      }
    }
  }

  return filasEscritas;
}

/**
 * Recalcula `calculos_diarios` de un empleado en un rango de fechas. Devuelve
 * la cantidad de filas escritas.
 */
export async function recalcularEmpleadoPeriodo(
  supabase: SupabaseClient,
  empleadoId: string,
  desde: Date,
  hasta: Date
): Promise<number> {
  return recalcularLote(supabase, [empleadoId], desde, hasta);
}

/**
 * Recalcula todos los empleados activos de un sector (o todos si `sectorId` es
 * null). Devuelve la cantidad de empleados recalculados.
 */
export async function recalcularSectorPeriodo(
  supabase: SupabaseClient,
  sectorId: string | null,
  desde: Date,
  hasta: Date
): Promise<number> {
  const empleados = await traerPaginado<{ id: string }>(() => {
    let query = supabase.from("empleados").select("id").eq("activo", true);
    if (sectorId) query = query.eq("sector_id", sectorId);
    return query.order("id");
  });

  const ids = empleados.map((e) => e.id);
  await recalcularLote(supabase, ids, desde, hasta);
  return ids.length;
}
