/**
 * Los cinco indicadores de un molino a partir de sus turnos. Es lógica pura:
 * recibe lo que `armarTurnos` devuelve y no sabe de dónde salió.
 *
 * Lo que decide el resultado es **qué entra en cada cuenta**, y son tres reglas
 * según el estado del turno:
 *
 * - **`inconsistente` aporta toneladas y no horas.** Las toneladas las midió una
 *   balanza y lo que falla es el reloj del PLC: descartarlas sería perder
 *   producción real. Pero sus horas no se pueden afirmar —la marcha excede lo
 *   que el bloque y la racha pueden explicar—, y meterlas inflaría la marcha o
 *   torcería la utilización hacia el lado que le toque al error.
 * - **`huerfano` no aporta nada.** Es un turno que el robot no informó, no un
 *   turno en cero: contarlo como parada inventaría horas de molino detenido que
 *   nadie vio. Ni numerador ni denominador.
 * - **`acumulado` aporta todo**, con la duración teórica de su racha (ya viene
 *   así en `minutosTeoricos`): la fila trae el trabajo de varios turnos y los
 *   faltantes que cubre son justamente lo que la hace creíble.
 *
 * Una razón sin denominador devuelve `null` y nunca 0, el mismo criterio que
 * `lib/trituracion/informeMensual.ts`: un cero se lee como un dato ("el molino
 * rindió cero") y un `null` como lo que es, "no hay con qué calcularlo".
 */

import type { TurnoDeRobot } from "./turnos";

export interface Indicadores {
  /** Incluye las de los turnos inconsistentes: las midió la balanza. */
  toneladas: number;
  horasDeMarcha: number;
  /** Teóricas menos marcha, sobre los mismos turnos que cuentan las horas. */
  horasNoTrabajadas: number;
  /** Marcha sobre teóricas, entre 0 y 1. `null` si no hay horas teóricas. */
  utilizacion: number | null;
  /**
   * Toneladas por hora de marcha, las dos tal como las informa este objeto: las
   * toneladas incluyen las de los turnos inconsistentes y las horas no. Es lo
   * que dice el spec (8,49 t/h en Filler 1 sale de 36.028 / 4.243). `null` si
   * no hay horas de marcha.
   */
  productividad: number | null;
  diasNoOperativos: number;
}

export function indicadoresDe(turnos: TurnoDeRobot[], diasNoOperativos: string[]): Indicadores {
  let kg = 0;
  let minutosMarcha = 0;
  let minutosTeoricos = 0;

  for (const t of turnos) {
    if (t.estado === "huerfano") continue;
    kg += t.kg;
    if (t.estado === "inconsistente") continue;
    minutosMarcha += t.minutosMarcha;
    minutosTeoricos += t.minutosTeoricos;
  }

  const horasDeMarcha = minutosMarcha / 60;
  return {
    toneladas: kg / 1000,
    horasDeMarcha,
    horasNoTrabajadas: (minutosTeoricos - minutosMarcha) / 60,
    utilizacion: minutosTeoricos > 0 ? minutosMarcha / minutosTeoricos : null,
    productividad: minutosMarcha > 0 ? kg / 1000 / horasDeMarcha : null,
    diasNoOperativos: diasNoOperativos.length,
  };
}
