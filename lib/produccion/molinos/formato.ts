/**
 * Cómo se dicen en pantalla las cosas de los molinos. Va aparte de las
 * pantallas para poder probarlo: la leyenda de un estado es una decisión del
 * dominio —qué se promedia y qué no— y no un adorno.
 */

import type { EstadoDeTurno, TurnoDeMolino } from "./types";

/**
 * El turno con la palabra que lo separa de los otros tres "turnos" del sistema
 * (el parte de fábrica, los horarios de RRHH y los del taller usan los mismos
 * números de reloj para otra cosa). Acá es el corte del contador del robot.
 */
export function comoSeLeeElTurnoDelRobot(turno: TurnoDeMolino): string {
  switch (turno) {
    case "00_04":
      return "00 a 04";
    case "04_12":
      return "04 a 12";
    case "12_20":
      return "12 a 20";
    case "20_00":
      return "20 a 24";
  }
}

/**
 * El nombre del molino como se dice en pantalla: **siempre acompañado**.
 * "Filler 1" y "Filler 2" ya son productos —finuras— en `/calidad/ensayos`, y
 * decir sólo "Filler 1" mezcla las dos cosas. Si el catálogo ya trae la palabra
 * no se repite.
 */
export function nombreDelMolino(nombre: string): string {
  return /^molino\b/i.test(nombre.trim()) ? nombre.trim() : `molino ${nombre.trim()}`;
}

/** Minutos como los lee una persona: "7 h 42 min", "45 min", "3 h". */
export function minutosComoSeLee(minutos: number): string {
  const total = Math.round(minutos);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * La leyenda de cada estado, la misma en las dos pantallas. `normal` no lleva:
 * lo que no tiene nada de raro no se señala.
 *
 * Lo que dicen es lo que `indicadoresDe` hace con cada uno, y ése es el punto:
 * si un día se cambia la regla, la leyenda tiene que cambiar con ella.
 */
export function leyendaDelEstado(
  estado: EstadoDeTurno,
  datos: { minutosMarcha: number; minutosTeoricos: number },
): string | null {
  switch (estado) {
    case "normal":
      return null;
    case "acumulado":
      return (
        `Acumulado: este renglón trae el trabajo de varios turnos que el robot no informó por separado. ` +
        `Su teórica es la de toda la racha (${minutosComoSeLee(datos.minutosTeoricos)}), no la de un turno, ` +
        `y no se reparte ni se promedia entre ellos.`
      );
    case "inconsistente":
      return (
        `Inconsistente: la marcha informada (${minutosComoSeLee(datos.minutosMarcha)}) excede lo que el turno ` +
        `puede explicar. Sus toneladas cuentan, las midió una balanza; sus horas no entran en ningún indicador.`
      );
    case "huerfano":
      return "El robot no informó este turno. No es una parada y no cuenta en ningún indicador.";
  }
}

/** Para un turno que no tiene renglón porque lo absorbió un acumulado posterior. */
export function leyendaDeUnTurnoCubierto(porFecha: string | null, porTurno: TurnoDeMolino | null): string {
  if (!porFecha || !porTurno) {
    return "No hay renglón de este turno en la base. Si lo absorbió un acumulado, el acumulado todavía no está cargado.";
  }
  const [a, m, d] = porFecha.split("-");
  return (
    `Sin renglón propio: lo cubre el turno acumulado de ${d}/${m}/${a} (${comoSeLeeElTurnoDelRobot(porTurno)}), ` +
    `que trae su trabajo y su teórica.`
  );
}

/** El orden de los cuatro en el reloj de un día: el de las 3:59 abre y el de las 23:59 cierra. */
export const TURNOS_EN_ORDEN_DE_RELOJ: readonly TurnoDeMolino[] = ["00_04", "04_12", "12_20", "20_00"];
