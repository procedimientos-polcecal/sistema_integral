import { dayOfWeekUtc, localDateTime } from "../dates";

/**
 * Desde qué día el sábado entero cuenta como hora normal (hasta las
 * `horasNormalesPorDia`) y sólo el excedente es extra al 100%.
 *
 * Los sábados anteriores se siguen calculando con la hora de corte: RRHH pidió
 * el 13/10/2026 que la regla corra "a partir de ahora" y no toque lo ya
 * cargado. Como el recálculo vuelve a pasar por días viejos (la ventana de 45
 * días, o el cambio de una fichada), la fecha tiene que vivir en el cálculo y
 * no en quién lo dispara: si no, la regla nueva se colaría hacia atrás.
 */
export const SABADO_NORMAL_DESDE = "2026-10-13";

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

/**
 * Si dos cantidades de horas son la misma.
 *
 * Las horas salen de dividir milisegundos: una jornada de 8h05 da
 * 0.08333… horas extra. `calculos_diarios` guarda `numeric(5,2)`, así que en la
 * base eso queda en 0.08. Comparar con `===` lo recién calculado contra lo
 * guardado da distinto siempre que la cuenta no dé redondo, aunque sean el
 * mismo dato — y eso borraba la validación de esos días en cada recálculo.
 *
 * Se comparan a la precisión que la base puede guardar. Medio centésimo de hora
 * son 18 segundos: nada que alguien haya querido decir con una marcación.
 */
export function mismasHoras(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
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

  if (tipoDia === "SABADO" && fecha.toISOString().slice(0, 10) >= SABADO_NORMAL_DESDE) {
    // Todo el día es hora normal hasta completar la jornada; lo que pasa de
    // `horasNormalesPorDia` es extra al 100%. En este régimen no hay extra al 50%.
    const total = sumHoras(intervals);
    return {
      tipoDia,
      horasNormales: Math.min(total, config.horasNormalesPorDia),
      horasExtra50: 0,
      horasExtra100: Math.max(0, total - config.horasNormalesPorDia),
      francoGenerado: false,
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
