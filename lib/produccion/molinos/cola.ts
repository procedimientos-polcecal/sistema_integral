/**
 * La cola de turnos sin explicar: lo único del módulo de molinos que una
 * persona carga. Lógica pura; la lectura de la base está en `consultas.ts`.
 *
 * Un turno entra en la cola cuando se cumplen **las cuatro** a la vez:
 *
 * 1. **Su parada llega al umbral.** La parada es lo que le falta a la marcha
 *    para llegar a la teórica. El umbral es un dato del catálogo
 *    (`produccion_molinos.umbral_minutos`, hoy 5) y no una constante: la
 *    columna dice "a partir de los que se pide un motivo", así que 5 minutos
 *    justos **sí** piden y 4 no. Un turno en el umbral exacto es un caso real
 *    (la marcha es un entero de minutos), y está fijado con un test.
 * 2. **Es de la puesta en servicio en adelante** (`desde`). Sin eso el
 *    historial llegaría como una avalancha de turnos que nadie va a recordar.
 * 3. **Nadie lo explicó**, ni con una parada propia ni con una de día entero
 *    (`turno` null = "planta parada", que tapa los cuatro).
 * 4. **No es huérfano.** Un huérfano es un turno que el robot no informó, no
 *    una parada: no se le puede pedir motivo a algo que no se sabe que ocurrió.
 *
 * Un `inconsistente` no necesita su propia regla: su marcha **excede** la
 * teórica, así que su parada da negativa y nunca llega al umbral. Es lo mismo
 * que hace `indicadoresDe`, que no cuenta sus horas.
 *
 * Se llama **por molino**: ni los turnos ni las paradas llevan el molino,
 * porque dos molinos comparten fecha y turno y cruzarlos taparía un turno con
 * la parada del otro. Quien llama pasa lo de un solo molino.
 */

import type { TurnoDeMolino } from "./types";
import type { TurnoDeRobot } from "./turnos";

/** Lo mínimo que hace falta saber de una parada cargada para decidir si tapa un turno. */
export interface ParadaCargada {
  /** "YYYY-MM-DD" */
  fecha: string;
  /** null = el día entero ("planta parada"). */
  turno: TurnoDeMolino | null;
}

/** Minutos que le faltaron a la marcha para llegar a la teórica. Negativo si se pasó. */
export function minutosDeParada(t: Pick<TurnoDeRobot, "minutosMarcha" | "minutosTeoricos">): number {
  return t.minutosTeoricos - t.minutosMarcha;
}

export function turnosSinExplicar(
  turnos: TurnoDeRobot[],
  paradas: ParadaCargada[],
  umbralMin: number,
  desde: string,
): TurnoDeRobot[] {
  const diasEnteros = new Set(paradas.filter((p) => p.turno === null).map((p) => p.fecha));
  const propias = new Set(paradas.filter((p) => p.turno !== null).map((p) => `${p.fecha}|${p.turno}`));

  return turnos.filter(
    (t) =>
      t.estado !== "huerfano" &&
      t.fecha >= desde &&
      minutosDeParada(t) >= umbralMin &&
      !diasEnteros.has(t.fecha) &&
      !propias.has(`${t.fecha}|${t.turno}`),
  );
}
