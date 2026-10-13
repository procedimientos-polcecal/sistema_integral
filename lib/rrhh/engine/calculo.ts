import { dayOfWeekUtc } from "../dates";

export type TipoDia = "HABIL" | "SABADO" | "DOMINGO" | "FERIADO";

export interface TimeInterval {
  start: Date;
  end: Date;
}

export interface PayrollConfigLike {
  horasNormalesPorDia: number;
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
    // Todo el día cuenta como hora normal hasta completar la jornada; recién lo
    // que pasa de `horasNormalesPorDia` es extra, y al 100%. Antes el sábado se
    // partía en una hora de corte (lo de antes: normal y 50%; lo de después:
    // 100%), regla que se dejó el 13/10/2026 a pedido de RRHH. Acá no hay extra
    // al 50% en ningún caso.
    const total = sumHoras(intervals);
    return {
      tipoDia,
      horasNormales: Math.min(total, config.horasNormalesPorDia),
      horasExtra50: 0,
      horasExtra100: Math.max(0, total - config.horasNormalesPorDia),
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
