/**
 * De la fila de `mant_programacion_referencia` al turno de una persona.
 *
 * POR QUÉ ESTÁ ACÁ Y NO ADENTRO DE UNA RUTA
 *
 * Esto lo necesitan dos pantallas: la programación semanal del taller y —desde
 * el 13/11/2026— el parte diario, que ofrece primero a los del turno elegido.
 * Escrito dos veces, el día que cambie cuál referencia rige, una de las dos
 * queda contestando distinto sobre la misma semana y nada avisa. Es el mismo
 * motivo por el que `repartirRegistroDeOT` salió de su ruta.
 *
 * Funciones puras: reciben las filas ya leídas y no tocan la base.
 */

import type { Grupo, Oficio, Referencia, Turno } from "./programacion";
import { turnoDelElectricista, turnoDelGrupo } from "./programacion";

/** Una fila de `mant_programacion_referencia`, tal como la devuelve la base. */
export interface FilaDeReferencia {
  lunes: string;
  grupo_en_4a12: string;
  electricista_4a12_id: string;
  electricista_8a16_id: string;
  electricista_12a20_id: string;
}

/** Una fecha que vino de la base, como `YYYY-MM-DD` pelado. */
const soloElDia = (v: unknown): string => String(v ?? "").slice(0, 10);

/**
 * Cuál de las referencias rige la semana que empieza el `lunes` pedido.
 *
 * **La más nueva que no sea posterior**, y NO la más nueva a secas: si alguien
 * vuelve a anclar el ciclo, una semana pasada se recalcularía con el ancla
 * nueva y cambiaría lo que el encargado vio en su momento.
 *
 * Si no hay ninguna anterior se toma **la más vieja** y el ciclo se extrapola
 * hacia atrás. Eso supone que la rotación corría igual entonces, y es lo que
 * permite mirar semanas anteriores a la carga del ancla.
 *
 * Sin ninguna fila devuelve `null`: no hay ciclo, y quien llama decide qué
 * mostrar. Hoy es el caso real —no hay ninguna referencia cargada—, así que no
 * es una rama teórica.
 */
export function laQueRige(filas: FilaDeReferencia[], lunes: string): FilaDeReferencia | null {
  if (filas.length === 0) return null;
  const ordenadas = [...filas].sort((a, b) => soloElDia(a.lunes).localeCompare(soloElDia(b.lunes)));
  const anteriores = ordenadas.filter((f) => soloElDia(f.lunes) <= lunes);
  return anteriores.length > 0 ? anteriores[anteriores.length - 1] : ordenadas[0];
}

/** La fila de la base como la espera el ciclo. */
export function comoReferencia(fila: FilaDeReferencia): Referencia {
  return {
    lunes: soloElDia(fila.lunes),
    grupoEn4a12: fila.grupo_en_4a12 as Grupo,
    electricistas: {
      "4-12": fila.electricista_4a12_id,
      "8-16": fila.electricista_8a16_id,
      "12-20": fila.electricista_12a20_id,
    },
  };
}

/**
 * El turno que el ciclo le da a una persona esa semana, o `null`.
 *
 * Sale `null` en dos casos que no son lo mismo y conviene no confundir: un
 * electricista que no es ninguno de los tres de la referencia, y un mecánico o
 * lubricador **sin grupo**, que no debería existir porque la ruta del padrón lo
 * rechaza. Los dos quedan sin turno, que es lo honesto: el ciclo no sabe dónde
 * ponerlos y ubicarlos igual sería inventar.
 *
 * Esto NO mira pisadas ni ausencias: es el turno del ciclo. Quien necesite el
 * turno real de un día —la programación semanal— le aplica la pisada encima.
 */
export function turnoDeLaPersona(
  ref: Referencia,
  lunes: string,
  persona: { empleadoId: string; oficio: Oficio; grupo: Grupo | null }
): Turno | null {
  if (persona.oficio === "electricista") {
    return turnoDelElectricista(ref, lunes, persona.empleadoId);
  }
  return persona.grupo ? turnoDelGrupo(ref, lunes, persona.grupo) : null;
}
