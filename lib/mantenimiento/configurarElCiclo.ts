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
