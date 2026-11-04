import { comoSeLee, esFechaIso } from "@/lib/core/fechas";
import { fechaParaElCalendario, laOTEstaCerrada } from "@/lib/agenda/evento";
import { MAXIMO_DE_DIAS } from "./postergar";

/**
 * Mandar un plan del día al calendario: qué hacer con cada ítem.
 *
 * ── EL PLAN MANDA LA FECHA, SALVO DONDE EL SISTEMA NO PUEDE ESCRIBIRLA ───────
 *
 * Es lo que se pidió: la planificación decide para qué día queda una OT. Pero
 * mover la fecha de una orden es **la escritura más peligrosa del módulo** (ver
 * `app/api/mantenimiento/ordenes/[id]/postergar/route.ts`) y tiene tres límites
 * que esta función respeta en vez de esquivar:
 *
 * - **Sólo se postergan las que creó el SdG.** Medido el 04/11/2026: 151 de
 *   2.410 órdenes. Las otras 2.259 viven en la pestaña que maneja Google Forms y
 *   escribir ahí corrió la OT 2796 dos filas. Para esas, el plan no puede
 *   cambiar la fecha: se manda en la de la orden y se dice.
 * - **Postergar sólo va hacia adelante** (`dias > 0`). Un plan anterior a la
 *   fecha de la orden no se puede aplicar: adelantar no es postergar.
 * - **Y no más de `MAXIMO_DE_DIAS`.** Un plan 91 días adelante casi seguro es una
 *   fecha mal tipeada, y deshacer una postergación es volver a escribir la celda
 *   y esperar otra vez el derrame.
 *
 * Fuera de esos casos —y de una OT cerrada o ya borrada— el plan manda.
 *
 * ── LA FECHA DE LA ORDEN ES LA DE LA ORDEN, NO LA COPIA DEL ÍTEM ─────────────
 *
 * El ítem guarda su propia copia editable de `fecha_ejecucion` que **nunca
 * vuelve a la orden**: `add_item` no exige que coincida con la del plan y
 * `update_item` la cambia sin tocar la orden. Por eso esta función **no recibe
 * esa copia**: decide con la orden leída de la base, y la fecha de la orden es
 * la que usa el calendario (`fechaParaElCalendario`: la pendiente, si la hay,
 * porque es la que se acaba de elegir y la planilla todavía no devolvió).
 */

export type QueHacerConElItem =
  /** Ya está para el día del plan. */
  | { que: "mandar"; fecha: string }
  /** El plan es posterior y la orden es del SdG: se le corre la fecha y después se manda. */
  | { que: "correr-y-mandar"; dias: number; fecha: string }
  /** No se le puede mover la fecha: se manda en la que tiene y se dice por qué. */
  | { que: "mandar-avisando"; fecha: string; aviso: string }
  | { que: "saltear"; motivo: string };

/**
 * La razón con la que el plan posterga. **No es `falta_repuesto` prestada**:
 * esa razón se escribe en la auditoría y en la columna de observación previa de
 * la planilla de producción, y diría un motivo falso. Tiene su fila en
 * `mant_razones_de_postergacion`, inactiva, para que el menú manual no la
 * ofrezca: es de este camino y de ningún otro.
 */
export const RAZON_DEL_PLAN = "planificacion_del_dia";

/** Lo que dice la nota de la orden (y, de ahí, la planilla) cuando la movió el plan. */
export function justificacionDelPlan(fechaDelPlan: string): string {
  return `Movida al plan del ${comoSeLee(fechaDelPlan)}.`;
}

/** Días de calendario de `desde` a `hasta`, ambas `AAAA-MM-DD` válidas. */
function diasEntre(desde: string, hasta: string): number {
  const t = (iso: string) => {
    const [a, m, d] = iso.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((t(hasta) - t(desde)) / 86_400_000);
}

export function queHacerConElItem(
  item: { ot_number: number },
  orden: {
    fecha_ejecucion: string | null;
    fecha_ejecucion_pendiente: string | null;
    fecha_cierre: string | null;
    estado: string | null;
    app_created: boolean | null;
  } | null,
  fechaDelPlan: string
): QueHacerConElItem {
  const ot = `La OT ${item.ot_number}`;

  // Se borró entre que se abrió la pantalla y se apretó el botón: se informa y
  // el lote sigue.
  if (!orden) return { que: "saltear", motivo: `${ot} ya no existe.` };

  if (laOTEstaCerrada(orden)) {
    return { que: "saltear", motivo: `${ot} ya está cerrada: no se manda al calendario.` };
  }

  const suFecha = fechaParaElCalendario(orden);
  if (!suFecha || !esFechaIso(suFecha)) {
    return {
      que: "saltear",
      motivo: `${ot} no tiene una fecha de ejecución válida, así que no hay de dónde correrla ni en qué día mandarla.`,
    };
  }

  if (suFecha === fechaDelPlan) return { que: "mandar", fecha: suFecha };

  const delPlan = comoSeLee(fechaDelPlan);
  const deLaOrden = comoSeLee(suFecha);

  // ISO: el orden alfabético es el cronológico.
  if (fechaDelPlan < suFecha) {
    return {
      que: "mandar-avisando",
      fecha: suFecha,
      aviso:
        `El plan es del ${delPlan} pero la orden está para el ${deLaOrden}, y desde acá ` +
        `una fecha sólo se puede correr hacia adelante. Se mandó el ${deLaOrden}.`,
    };
  }

  if (!orden.app_created) {
    return {
      que: "mandar-avisando",
      fecha: suFecha,
      aviso:
        `El plan es del ${delPlan} pero la orden entró por el formulario y su fecha no se ` +
        `puede mover desde el sistema: vive en la planilla que maneja Google Forms. ` +
        `Se mandó el ${deLaOrden}; si tiene que ser el ${delPlan}, hay que cambiarla en la planilla.`,
    };
  }

  const dias = diasEntre(suFecha, fechaDelPlan);
  if (dias > MAXIMO_DE_DIAS) {
    return {
      que: "mandar-avisando",
      fecha: suFecha,
      aviso:
        `El plan es del ${delPlan}, ${dias} días después de la fecha de la orden (${deLaOrden}), ` +
        `y no se corre más de ${MAXIMO_DE_DIAS} de una vez. Se mandó el ${deLaOrden}.`,
    };
  }

  return { que: "correr-y-mandar", dias, fecha: fechaDelPlan };
}
