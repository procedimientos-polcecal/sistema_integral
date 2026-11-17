import { addUtcDays, diaIso } from "../dates";

/**
 * A qué día pertenece la salida que alguien acaba de tipear.
 *
 * POR QUÉ EXISTE
 *
 * El modal de corrección tiene un campo de fecha para la entrada y otro para
 * la salida, y el de la salida arranca igual al de la entrada. Para el turno
 * de 20 a 4 eso es siempre lo contrario de lo correcto: quien corrige escribe
 * 03:45 en la hora, no mira la fecha —que ya dice el día de la entrada— y
 * guarda una salida **dieciséis horas antes** de la entrada.
 *
 * No es hipotético y no es un descuido aislado: medido contra la base el
 * 30/10/2026, hay **23 fichadas con la salida anterior a la entrada, y 18 de
 * ellas las escribió una persona a mano**, todas turnos de noche, la más
 * reciente del día anterior. Se repite porque la importación deja el turno de
 * noche mal en el borde de la ventana, RRHH lo corrige, y la corrección
 * también queda mal.
 *
 * La regla no adivina nada: una salida **anterior** a la entrada no puede ser
 * del mismo día, porque un turno no termina antes de empezar. Si es anterior,
 * es del día siguiente. Si es igual o posterior, se deja como está.
 */
export function diaDeLaSalida(fechaEntrada: string, horaEntrada: string, horaSalida: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEntrada)) return fechaEntrada;
  if (!/^\d{2}:\d{2}/.test(horaEntrada) || !/^\d{2}:\d{2}/.test(horaSalida)) return fechaEntrada;
  return horaSalida < horaEntrada ? diaIso(addUtcDays(new Date(fechaEntrada), 1)) : fechaEntrada;
}

/**
 * El problema de una fila antes de guardarla, o null si está bien.
 *
 * Es el cinturón de la regla de arriba: `diaDeLaSalida` acomoda la fecha
 * mientras se tipea, pero los dos campos de fecha se pueden editar a mano y
 * nada impedía guardar una salida anterior a la entrada. El resultado no da
 * ningún error —se guarda, se recalcula y queda— y lo único que se ve después
 * es un día con horas raras.
 */
export function problemaDeLaFila(entrada: string | null, salida: string | null): string | null {
  if (!entrada) return "Falta la hora de entrada.";
  if (salida && Date.parse(salida) <= Date.parse(entrada)) {
    return "La salida no puede ser anterior ni igual a la entrada. Si el turno termina al otro día, corregí la fecha de salida.";
  }
  return null;
}

/**
 * La salida que de verdad cierra el turno, corrida al día siguiente si hace
 * falta.
 *
 * Es `diaDeLaSalida` para los caminos que ya trabajan con instantes y no con
 * los dos campos de un formulario: hoy, el Excel en **modo separado**, que
 * trae una columna de hora de entrada y otra de salida pero **un solo día**.
 * Con un turno de 20 a 4 eso daba la salida dieciséis horas antes de la
 * entrada, igual que el modal — el mismo defecto por otra puerta.
 *
 * Se corre **un solo día**, nunca hasta que dé positivo: si con un día todavía
 * queda antes, lo que hay es un dato roto y no un turno de 32 horas. Eso lo
 * frena `problemaDeLaFila` del lado de las rutas.
 */
export function salidaDelTurno(entrada: Date, salida: Date | null): Date | null {
  if (!salida) return null;
  if (salida.getTime() > entrada.getTime()) return salida;
  return new Date(salida.getTime() + 24 * 60 * 60 * 1000);
}
