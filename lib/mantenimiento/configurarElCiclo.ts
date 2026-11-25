/**
 * Las reglas de la sección «Lo que crea órdenes solo».
 *
 * Lo que se puede leer de un ciclo y lo que se puede guardarle, sacado de la
 * pantalla para poder probarlo. El diseño está en
 * `docs/superpowers/specs/2026-11-24-mantenimiento-configurar-ot-automaticas-design.md`.
 */

import { comoSeLee } from "@/lib/core/fechas";
import { caraDeLaVuelta, type Decision } from "./cicloDeOT";
import { pareceUnCambio } from "./sospechaDeCambio";
import { ACCIONES_PREVENTIVAS } from "./tareasPreventivas";

/**
 * Qué va a hacer el ciclo, en una línea.
 *
 * Cubre las cuatro formas de `Decision`. `trabado` devuelve el motivo tal cual
 * y no lo envuelve: ese texto ya está escrito para que lo lea una persona, y
 * es el mismo que aparece en `/administracion/salud`.
 */
export function comoSeLeeLaDecision(
  d: Decision,
  tareas: { madre: string; hija: string }
): string {
  switch (d.que) {
    case "crear":
      return d.vuelta === 0
        ? `Crea «${tareas.madre}» para el ${comoSeLee(d.fecha_ejecucion)}`
        : `Crea «${tareas.hija}» — a ${caraDeLaVuelta(d.vuelta)} cara — para el ${comoSeLee(d.fecha_ejecucion)}`;
    case "esperar":
      return `Espera la OT ${d.ot}`;
    case "sin_arrancar":
      return "No arrancó, así que no genera ninguna orden";
    case "trabado":
      return d.porque;
  }
}

/**
 * Si el arranque automático puede ver a la madre de este ciclo.
 *
 * ── POR QUÉ ESTO HACE FALTA, Y NO ES UN DETALLE ────────────────────────────
 *
 * Un ciclo nace sin arrancar y arranca solo con el primer trabajo que **el
 * detector reconozca como un cambio de la pieza**. Y el detector no mira
 * `tarea_madre_id`: `elArranqueDeUnCambio()` llama a `pareceUnCambio()`, que
 * busca verbos de reemplazo —cambiar, reemplazar, recambiar, colocar, poner,
 * instalar— pegados al componente, y descarta a propósito las rotaciones.
 *
 * O sea que de las dieciséis acciones del vocabulario, sólo una madre que la
 * gente escriba como un reemplazo va a disparar el arranque. Un ciclo cuya
 * madre sea `LIMPIEZA` o `REVISION` **nace dormido para siempre**, y la
 * dormidera es invisible: una orden que nunca nace nunca se atrasa, así que
 * `mant-atrasadas-por-fecha` tampoco puede nombrarla.
 *
 * Por eso se avisa en vez de prohibir: prohibir acciones cerraría casos
 * legítimos, y la casa prefiere decir la verdad antes que adivinar.
 *
 * ── POR QUÉ LE PREGUNTA AL DETECTOR Y NO A UNA LISTA ───────────────────────
 *
 * Arma el texto que escribiría una persona —la etiqueta corta de la acción más
 * el componente— y se lo pasa a `pareceUnCambio()`. Una lista de claves acá
 * sería una segunda definición de lo mismo, que el día que el regex cambie
 * queda desfasada sin que nada avise.
 *
 * Y usa **el componente de este ciclo**, no uno de muestra: el detector
 * descarta las rotaciones de ese componente en particular, así que la
 * respuesta puede depender de cuál sea.
 */
export function arrancaSolo(accionMadre: string, componente: string): boolean {
  const accion = ACCIONES_PREVENTIVAS.find((a) => a.clave === accionMadre);
  if (!accion) return false;

  return pareceUnCambio(`${accion.corta} ${componente}`, componente);
}

/** Lo que se le puede cambiar a un ciclo ya armado. */
export interface Parametros {
  periodo_dias?: number | null;
  repeticiones?: number;
  especialidad?: string | null;
  horas_estimadas?: number | null;
  activo?: boolean;
  tarea_madre_id?: string;
  tarea_hija_id?: string;
}

/** El ciclo como está hoy, que es contra lo que se validan los cambios. */
export interface CicloComoEsta {
  repeticiones: number;
  vuelta_desde: number | null;
  tarea_madre_id: string;
  tarea_hija_id: string;
}

/**
 * Qué impide guardar estos parámetros. Vacío quiere decir que se puede.
 *
 * ── POR QUÉ LOS LÍMITES ESTÁN ACÁ Y NO SÓLO EN LA BASE ─────────────────────
 *
 * Porque los checks de `mant_ciclos_de_ot` y de `mant_tareas_preventivas` ya
 * los niegan, pero lo hacen con un 500 y un mensaje de Postgres. Esta pantalla
 * es la primera donde alguien puede cambiar el plazo y las repeticiones de un
 * ciclo —hasta hoy no se podían tocar—, así que es también la primera manera
 * de fabricar órdenes de más con un número mal tipeado. Los límites de abajo
 * son los mismos que los de la base, copiados a propósito.
 *
 * El que no es un check de la base es el de `vuelta_desde`: bajar las
 * repeticiones por debajo de la vuelta en curso **sí** rompe
 * `mant_ciclos_de_ot_vuelta`, pero lo que hay que decir no es eso sino en qué
 * vuelta está el ciclo.
 *
 * Informa **todos** los problemas juntos, como el resto del módulo.
 */
export function loQueImpideGuardar(p: Parametros, ciclo: CicloComoEsta): string[] {
  const problemas: string[] = [];

  if (p.repeticiones !== undefined) {
    if (!Number.isInteger(p.repeticiones) || p.repeticiones < 1 || p.repeticiones > 20) {
      problemas.push("Las repeticiones van de 1 a 20.");
    } else if (ciclo.vuelta_desde !== null && p.repeticiones < ciclo.vuelta_desde) {
      problemas.push(
        `El ciclo está en la vuelta ${ciclo.vuelta_desde}, así que no puede repetirse ` +
        `menos de ${ciclo.vuelta_desde} veces.`
      );
    }
  }

  if (p.periodo_dias !== undefined && p.periodo_dias !== null) {
    if (!Number.isFinite(p.periodo_dias) || p.periodo_dias < 1 || p.periodo_dias > 3650) {
      problemas.push("El plazo va de 1 a 3650 días. Vaciarlo detiene el ciclo.");
    }
  }

  if (p.horas_estimadas !== undefined && p.horas_estimadas !== null) {
    if (!Number.isFinite(p.horas_estimadas) || p.horas_estimadas < 0) {
      problemas.push("Las horas estimadas no pueden ser negativas.");
    }
  }

  // Sólo cuando se mandan tareas: no mandarlas no es un cambio de tareas, y el
  // alta —que no tiene un ciclo contra el cual comparar— pasa ids vacíos.
  if (p.tarea_madre_id !== undefined || p.tarea_hija_id !== undefined) {
    const madre = p.tarea_madre_id ?? ciclo.tarea_madre_id;
    const hija = p.tarea_hija_id ?? ciclo.tarea_hija_id;
    if (madre === hija) {
      problemas.push("La tarea que se repite y la que cierra el ciclo tienen que ser distintas.");
    }
  }

  return problemas;
}

/**
 * Lo que hay que escribirle al ciclo cuando se le cambia el par de tareas, o
 * `null` si el par no cambió.
 *
 * ── POR QUÉ CAMBIAR LAS TAREAS LO DEVUELVE A «SIN ARRANCAR» ────────────────
 *
 * Porque `desde` y `vuelta_desde` describen el par viejo. «La 2ª rotación el
 * 14/11» no quiere decir nada si la hija pasó a ser otra tarea, y dejarlo ahí
 * haría que el ciclo siguiera contando vueltas de un trabajo que ya no es el
 * suyo. El estado anterior no se puede traducir: se tira, y la pantalla lo
 * dice antes de guardar.
 *
 * ── Y POR QUÉ LAS TAREAS SE PUEDEN CAMBIAR ─────────────────────────────────
 *
 * Porque si no, no hay salida. `unique (equipment_id)` admite un solo ciclo
 * por equipo, no hay botón de borrar —borrarlo dejaría en null el `ciclo_id`
 * de todas sus órdenes— y el alta no ofrece equipos que ya tengan uno. Sin
 * esto, un equipo cuyo ciclo se apagó no podría tener otro nunca más.
 *
 * Las OT viejas conservan su `ciclo_id` y no molestan: el corte las deja
 * afuera, porque un ciclo sin arrancar no cuenta ninguna y, cuando arranque,
 * contará sólo desde esa fecha hacia adelante.
 *
 * Compara contra lo que el ciclo tiene hoy y no contra la presencia del campo:
 * mandar el mismo id no es un cambio.
 */
export function elResetPorCambioDeTareas(
  p: Parametros,
  ciclo: CicloComoEsta
): { desde: null; vuelta_desde: null } | null {
  const cambioLaMadre = p.tarea_madre_id !== undefined && p.tarea_madre_id !== ciclo.tarea_madre_id;
  const cambioLaHija = p.tarea_hija_id !== undefined && p.tarea_hija_id !== ciclo.tarea_hija_id;

  return cambioLaMadre || cambioLaHija ? { desde: null, vuelta_desde: null } : null;
}

/**
 * Cada cuánto corre un mantenimiento programado, el **otro** motor de OT
 * automáticas.
 *
 * Las etiquetas viven acá y no en la pantalla de programados porque las miran
 * las dos: la sección de Configuración las lista y aquella las ofrece en su
 * formulario. Un tipo que no esté en la lista se muestra crudo en vez de
 * desaparecer — una fila sin texto se lee como «no tiene programa», que es
 * otra cosa.
 */
export const PROGRAMAS: readonly { value: string; label: string }[] = [
  { value: "DIARIO", label: "Diario" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "QUINCENAL", label: "Quincenal" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "TRIMESTRAL", label: "Trimestral" },
  { value: "SEMESTRAL", label: "Semestral" },
  { value: "ANUAL", label: "Anual" },
  { value: "PERSONALIZADO", label: "Personalizado (días)" },
  { value: "FECHA_FIJA", label: "Fecha fija (única)" },
];

export function comoSeLeeElPrograma(
  scheduleType: string,
  intervalDays: number | null
): string {
  const etiqueta = PROGRAMAS.find((p) => p.value === scheduleType)?.label ?? scheduleType;
  return intervalDays ? `${etiqueta} · cada ${intervalDays} días` : etiqueta;
}
