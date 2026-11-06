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
 * **Una fecha que ya pasó no se manda**, en ningún caso (ver `destinoVigente`).
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
 * La razón con la que el plan posterga. **Es un código de sistema, no una fila
 * del catálogo, y no tiene que estarlo.**
 *
 * `mant_razones_de_postergacion` es la tabla del **menú manual**: `etiqueta`,
 * `dias`, `orden` y `activa` son todas preocupaciones de menú, y la ruta de
 * postergar **nunca valida contra ella** —`razon` es texto libre que va a la nota
 * y al `contexto` de la auditoría—. Una fila acá no compraría nada y dejaría un
 * arma cargada: Configuración lista las razones activas **e inactivas** con un
 * botón «Ofrecerla», y un clic la volvería una opción manual; desde ahí, una
 * postergación que ningún plan hizo quedaría registrada con este motivo en la
 * auditoría y en la celda de observación previa de la planilla de producción,
 * que es exactamente el daño que esta razón dedicada existe para evitar. Se
 * cargó una fila el 04/11/2026 y se sacó el mismo día (migración
 * `20261104165733`).
 *
 * Tampoco es `falta_repuesto` prestada: diría un motivo falso en los mismos dos
 * lugares.
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
  fechaDelPlan: string,
  /** Hoy en Argentina, `AAAA-MM-DD`. */
  hoy: string
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

  if (suFecha === fechaDelPlan) return destinoVigente({ que: "mandar", fecha: suFecha }, ot, "", hoy);

  const delPlan = comoSeLee(fechaDelPlan);
  const deLaOrden = comoSeLee(suFecha);

  // Cada «no se pudo mover» es un motivo y la fecha en la que queda: el aviso
  // dice que se mandó ahí, y si esa fecha ya pasó, que no.
  const enSuFecha = (porQue: string) => destinoVigente(
    { que: "mandar-avisando", fecha: suFecha, aviso: `${porQue} Se mandó el ${deLaOrden}.` },
    ot,
    porQue,
    hoy
  );

  // ISO: el orden alfabético es el cronológico.
  if (fechaDelPlan < suFecha) {
    return enSuFecha(
      `El plan es del ${delPlan} pero la orden está para el ${deLaOrden}, y desde acá ` +
        `una fecha sólo se puede correr hacia adelante.`
    );
  }

  if (!orden.app_created) {
    return enSuFecha(
      `El plan es del ${delPlan} pero la orden entró por el formulario y su fecha no se ` +
        `puede mover desde el sistema: vive en la planilla que maneja Google Forms. ` +
        `Si tiene que ser el ${delPlan}, hay que cambiarla en la planilla.`
    );
  }

  const dias = diasEntre(suFecha, fechaDelPlan);
  if (dias > MAXIMO_DE_DIAS) {
    return enSuFecha(
      `El plan es del ${delPlan}, ${dias} días después de la fecha de la orden (${deLaOrden}), ` +
        `y no se corre más de ${MAXIMO_DE_DIAS} de una vez.`
    );
  }

  return destinoVigente({ que: "correr-y-mandar", dias, fecha: fechaDelPlan }, ot, "", hoy);
}

/**
 * **El pasado se rechaza acá y en ningún otro lugar.** `mandarLaOTAlCalendario`
 * mira si la fecha pasó sólo con `turno: null`; con un turno elegido a mano no,
 * porque mandar a mano una orden de ayer es una decisión de una persona. En un
 * plan no hay nadie decidiendo eso, y sin esta comprobación el resultado
 * dependía de si la orden tenía turno puesto: unos ítems de la misma corrida
 * fallaban con «la fecha ya pasó» y otros creaban un evento en el pasado, sin
 * nada que lo explicara. Y la forma común de las 2.259 órdenes del formulario es
 * justamente una fecha vieja.
 *
 * Se mira **el día en que quedaría el evento**, no el de la orden ni el del
 * plan: un plan viejo sobre una orden futura se manda bien en la fecha de la
 * orden. El día de hoy todavía entra: el filtro es por día y no por hora.
 */
function destinoVigente(
  decision: Exclude<QueHacerConElItem, { que: "saltear" }>,
  quienEs: string,
  porQue: string,
  hoy: string
): QueHacerConElItem {
  if (decision.fecha >= hoy) return decision;
  const cuando = comoSeLee(decision.fecha);
  return {
    que: "saltear",
    motivo: porQue
      ? `${porQue} Y el ${cuando} ya pasó, así que no se mandó.`
      : `${quienEs} quedaría para el ${cuando}, que ya pasó: no se manda un evento al pasado.`,
  };
}
