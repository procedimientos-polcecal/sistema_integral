import { DURACION_OT_MINUTOS, instanteDe } from "@/lib/agenda/evento";
import { norm } from "@/lib/core/texto";

/**
 * Dónde cae, dentro de su día, el evento de una OT que entra sola al calendario.
 *
 * Sin red y sin base. Las OT de una misma especialidad **no pueden caer todas a
 * las 08:00**: dos mecánicos con dos órdenes a la misma hora son un conflicto
 * que el calendario muestra como superposición. Por eso se **apilan**: la
 * primera arranca a las 08:00, la siguiente 1:30 después, y así.
 */

/** Hora de pared a la que arranca la primera OT del día. */
export const HORA_DE_ARRANQUE = "08:00";

/**
 * La última hora a la que puede arrancar una OT. Es el fin del octavo turno de
 * 1:30 contando desde las 08:00 (08:00 + 8 × 1:30), así que **nueve** órdenes
 * entran sin tocar el tope.
 */
export const TOPE_DE_ARRANQUE = "20:00";

/**
 * Lo que se le dice a quien abre una OT que quedó contra el tope. Vive acá y no
 * en la ruta porque habla de `TOPE_DE_ARRANQUE`: si uno cambia, el otro tiene
 * que cambiar con él.
 *
 * **No nombra una cantidad**, a propósito: cuántas órdenes entran antes del
 * tope depende de dónde arranca el turno —nueve desde las 08:00, once desde las
 * 04:00, seis desde las 12:00— y el texto se guarda en la columna `aviso`, donde
 * una persona lo lee. Un número fijo era falso en dos de los tres caminos.
 *
 * **Este texto se compara por igualdad** (`elEventoSigueALaOT.ts` y
 * `mandarLaOT.ts` deciden con `=== AVISO_DE_TOPE` si un aviso es suyo y se
 * puede limpiar). Mientras nada de esta rama estuviera desplegado, ninguna fila
 * de `agenda_eventos.aviso` lo llevaba y cambiarlo era gratis. **Desde el
 * despliegue deja de serlo**: una fila con el texto viejo se leería como un
 * aviso escrito por una persona y su evento quedaría congelado. Reescribir la
 * frase pasa a ser una migración de datos de esa columna, no una edición.
 */
export const AVISO_DE_TOPE =
  "Ese día ya tiene órdenes de esa especialidad hasta el tope: ésta comparte las 20:00 con las que no entraron.";

const aMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const dos = (n: number) => String(n).padStart(2, "0");
const aHoraDePared = (minutos: number) => `${dos(Math.floor(minutos / 60))}:${dos(minutos % 60)}`;

/** Una hora de pared `hh:mm` que existe en el reloj. */
const ES_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * El horario de una OT que tiene `ocupados` órdenes de su misma especialidad ya
 * puestas ese día, o `null` si la fecha no es un día válido (`AAAA-MM-DD`).
 *
 * **El tope no es opcional.** Sin él, la undécima caería a las 24:30 y
 * `instanteDe` rechazaría esa fecha-hora: la OT se quedaría **sin evento y sin
 * que nada lo avise**. De la décima en adelante comparten las 20:00 y salen con
 * `topeado: true`, para que quien llama lo anote (`AVISO_DE_TOPE`).
 *
 * Las cadenas se arman con aritmética sobre minutos y **sin `Date`**, como
 * `horarioDeLaOT`: el servidor corre en UTC y una `Date` metería su zona en una
 * hora que es de pared de Argentina. El fin más alto es 21:30, así que ningún
 * horario cruza la medianoche. Sale sin zona (`2026-11-06T08:00:00`).
 *
 * **`arranque` casi siempre es `HORA_DE_ARRANQUE`**, que es lo que apila una OT
 * que nace sola. Lo recibe por el barrido (`elEventoSigueALaOT`): cuando una
 * orden cambia de fecha, su evento se vuelve a ubicar **desde el turno que
 * tiene guardado**, que puede arrancar a las 04:00 o a las 12:00. El tope de
 * reloj es el mismo, así que desde las 04:00 entran once y desde las 12:00
 * seis. El texto de `AVISO_DE_TOPE` no nombra ninguna cantidad justamente por
 * eso: sirve igual para los tres arranques.
 */
export function horarioApilado(
  fecha: string,
  ocupados: number,
  arranqueDelDia: string = HORA_DE_ARRANQUE
): { inicio: string; fin: string; topeado: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || instanteDe(`${fecha}T00:00:00`) === null) return null;
  if (!Number.isInteger(ocupados) || ocupados < 0) return null;
  // Sin esto, un arranque mal formado daría `NaN:NaN` y el evento quedaría ilegible.
  if (!ES_HORA.test(arranqueDelDia)) return null;

  const tope = aMinutos(TOPE_DE_ARRANQUE);
  const sinTopear = aMinutos(arranqueDelDia) + ocupados * DURACION_OT_MINUTOS;
  const topeado = sinTopear > tope;
  const arranque = topeado ? tope : sinTopear;

  return {
    inicio: `${fecha}T${aHoraDePared(arranque)}:00`,
    fin: `${fecha}T${aHoraDePared(arranque + DURACION_OT_MINUTOS)}:00`,
    topeado,
  };
}

/**
 * La clave del grupo dentro del cual se apila: la especialidad, sin importar
 * mayúsculas, acentos ni espacios de más (`norm`, la misma que usan
 * `oficioDeLaEspecialidad` y `colorDeEspecialidad` sobre esta columna: con una
 * más débil, «MECANICO» y «MECÁNICO» serían grupos distintos y las dos órdenes
 * caerían a las 08:00). Una especialidad vacía o ausente es **su propio
 * grupo**: hay una OT en producción así y no puede reventar ni caer en el
 * montón de las mecánicas.
 */
export function claveDeApilado(especialidad: string | null | undefined): string {
  const limpia = norm(especialidad);
  return limpia ? limpia : "(sin especialidad)";
}

/**
 * **El grupo completo dentro del cual se cuenta un hueco: día, especialidad y
 * turno.** Es una sola definición y la usan los dos que cuentan —el alta
 * automática (`mandarLaOTAlCalendario`) y el barrido que reubica
 * (`elEventoSigueALaOT`)—, porque con dos claves distintas **el mismo evento
 * recibía un hueco distinto según cuál de los dos lo tocó último**, y eso
 * deriva solo sin que nada avise. Si se le agrega una dimensión, se le agrega
 * acá y a los dos a la vez.
 *
 * **El turno está adentro** porque «la misma especialidad es la misma gente»
 * vale dentro de un turno: los mecánicos de 4-12 y los de 8-16 son equipos
 * distintos, y apilar un evento de las 04:00 detrás de los del turno de 8 lo
 * correría por órdenes que nunca lo van a cruzar. Lo que eso deja abierto —que
 * dos turnos vecinos se solapen en el borde— está dicho en el encabezado de
 * `elEventoSigueALaOT.ts` y se decidió no resolverlo.
 */
export function claveDelHueco(
  fecha: string,
  especialidad: string | null | undefined,
  turno: string
): string {
  return `${fecha}|${claveDeApilado(especialidad)}|${turno}`;
}
