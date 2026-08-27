import { dayOfWeekUtc, localDateTime } from "../dates";

export type TipoDia = "HABIL" | "SABADO" | "DOMINGO" | "FERIADO";

export interface TimeInterval {
  start: Date;
  end: Date;
}

export interface PayrollConfigLike {
  horasNormalesPorDia: number;
  horaCorteSabado: string; // "HH:MM"
  feriadoComoDomingo: boolean;
}

export interface DailyCalcResult {
  tipoDia: TipoDia;
  horasNormales: number;
  horasExtra50: number;
  horasExtra100: number;
  francoGenerado: boolean;
}

function sumHoras(intervals: TimeInterval[]): number {
  return intervals.reduce((acc, i) => {
    const ms = i.end.getTime() - i.start.getTime();
    return acc + (ms > 0 ? ms / 3_600_000 : 0);
  }, 0);
}

function parseHoraCorte(fecha: Date, horaCorteSabado: string): Date {
  const [h, m] = horaCorteSabado.split(":").map(Number);
  return localDateTime(fecha, h, m);
}

export function determinarTipoDia(fecha: Date, esFeriado: boolean): TipoDia {
  if (esFeriado) return "FERIADO";
  const dow = dayOfWeekUtc(fecha); // 0=domingo, 6=sabado
  if (dow === 0) return "DOMINGO";
  if (dow === 6) return "SABADO";
  return "HABIL";
}

/**
 * Calcula horas normales / extra 50% / extra 100% y si corresponde franco
 * compensatorio para un día de un empleado, en base a los intervalos
 * trabajados (fichadas ya emparejadas entrada/salida) y la configuración
 * vigente. No consulta la base de datos: función pura para poder testear
 * cada regla del convenio de forma aislada.
 */
export function calcularDia(
  fecha: Date,
  intervals: TimeInterval[],
  esFeriado: boolean,
  config: PayrollConfigLike
): DailyCalcResult {
  const tipoDia = determinarTipoDia(fecha, esFeriado);
  const tratarComoDomingo = tipoDia === "DOMINGO" || (tipoDia === "FERIADO" && config.feriadoComoDomingo);

  if (tratarComoDomingo) {
    const total = sumHoras(intervals);
    return {
      tipoDia,
      horasNormales: 0,
      horasExtra50: 0,
      horasExtra100: total,
      francoGenerado: total > 0,
    };
  }

  if (tipoDia === "SABADO") {
    const cutoff = parseHoraCorte(fecha, config.horaCorteSabado);
    let antes = 0;
    let despues = 0;
    for (const i of intervals) {
      const antesEnd = i.end < cutoff ? i.end : cutoff;
      if (antesEnd > i.start) antes += (antesEnd.getTime() - i.start.getTime()) / 3_600_000;
      const despuesStart = i.start > cutoff ? i.start : cutoff;
      if (i.end > despuesStart) despues += (i.end.getTime() - despuesStart.getTime()) / 3_600_000;
    }
    const horasNormales = Math.min(antes, config.horasNormalesPorDia);
    const horasExtra50 = Math.max(0, antes - config.horasNormalesPorDia);
    return {
      tipoDia,
      horasNormales,
      horasExtra50,
      horasExtra100: despues,
      francoGenerado: false,
    };
  }

  // HABIL, o FERIADO cuando feriadoComoDomingo = false
  const total = sumHoras(intervals);
  const horasNormales = Math.min(total, config.horasNormalesPorDia);
  const horasExtra50 = Math.max(0, total - config.horasNormalesPorDia);
  return {
    tipoDia,
    horasNormales,
    horasExtra50,
    horasExtra100: 0,
    francoGenerado: false,
  };
}
