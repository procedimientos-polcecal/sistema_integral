/**
 * Qué dice una pantalla sobre un aviso, dada su orden de trabajo.
 *
 * Un aviso dice que una máquina anda mal y de él sale una orden de trabajo.
 * Hasta ahora `/mantenimiento/avisos` y `/mis-avisos` mostraban «OT #2814» y
 * nada más: eso contesta «¿alguien lo tomó?» y deja sin contestar la pregunta
 * que le importa a quien avisó, «¿se terminó de tratar?». Esta función es la
 * regla de qué mostrar, y es pura para que las dos pantallas digan lo mismo.
 *
 * ── POR QUÉ NO ES OTRA RAMA DE `finalDelAviso()` ─────────────────────────────
 *
 * `finalDelAviso()` (en `desestimarAviso.ts`) contesta **«¿se decidió qué hacer
 * con esto?»**: con OT, desestimado o pendiente. De ella cuelgan el filtro
 * «Sin OT» y los conteos de las dos pantallas, y andan bien. Ésta contesta
 * otra pregunta, **«¿ese trabajo ya terminó?»**, y necesita algo que aquella
 * no tiene ni debe tener: el estado de la orden. Mezclarlas movería los
 * conteos que hoy están bien, así que van aparte y no se tocan entre sí.
 *
 * ── «CERRADA» LA DECIDE `estado`, JAMÁS LA FECHA ─────────────────────────────
 *
 * Medido contra producción el 17/11/2026: de 2.489 OT, **220 están en
 * `REALIZADO` sin `fecha_cierre`** —cerca de una de cada diez—, y ninguna de
 * las 55 abiertas tiene fecha de cierre. O sea que la fecha sobra cuando está
 * y falta en trabajo terminado: una pantalla que leyera «sin fecha = abierta»
 * diría «abierta» sobre una de cada diez órdenes ya hechas. Por eso la fecha
 * viaja como dato opcional de lo cerrado y nunca decide nada.
 *
 * ── SIN ORDEN LEÍDA, LO QUE DECIDE ES EL AVISO ───────────────────────────────
 *
 * `/mis-avisos` la abren catorce personas y seis no tienen el módulo
 * Mantenimiento, así que esa pantalla lee el estado de la OT por una ruta
 * aparte que puede fallar. Una `ot` ausente quiere decir **«no se pudo leer la
 * orden»**, no «el aviso no tiene orden». **`null` y `undefined` se tratan
 * igual**: la diferencia sólo la hacen los campos del aviso. Si tiene
 * `work_order_id` o texto en `ot_asignada`, cae en `sin-enlace` con lo que ya
 * se mostraba; sólo sin ninguno de los dos es `sin-ot`. Así la pantalla nunca
 * dice «sin orden de trabajo» sobre un aviso que tiene enlace o texto, que es
 * el peor error posible acá. (Con `work_order_id` y sin texto, `sin-enlace`
 * trae `texto: ""` y la pantalla tiene que decidir qué decir.)
 *
 * ── EL TEXTO CRUDO NO SE INTERPRETA ──────────────────────────────────────────
 *
 * `ot_asignada` es texto libre de la planilla. Hoy hay siete que dicen
 * `Revision`, `-` o `si`, y dos que nombran **dos OT** (`1889 - 1886`,
 * `2567-2568`). Se muestran como vinieron: elegir una de las dos sería enlazar
 * al que se le parece, y un enlace equivocado no se nota nunca.
 *
 * (El enlace automático aviso → OT es otra cosa y vive en `enlaceDelAviso.ts`.)
 */

import { enDiaMes } from "./desestimarAviso";

/** Lo que hace falta saber de la orden. Es una proyección chica a propósito. */
export interface OtDelAviso {
  ot_number: number | null;
  estado: string | null;
  fecha_cierre: string | null;
}

export type EstadoDelTrabajo =
  /** La orden está `REALIZADO`. `fecha` puede faltar: son 220 de 2.489. */
  | { tipo: "cerrado"; ot: number; fecha: string | null }
  /** La orden existe y sigue sin cerrarse. `comoSeLlama` es para la pantalla. */
  | { tipo: "abierto"; ot: number; estado: string; comoSeLlama: string }
  /** Hay algo que decir pero no se pudo leer la orden: se muestra el texto crudo. */
  | { tipo: "sin-enlace"; texto: string }
  /** Se buscó y no hay orden: pendiente o desestimado. */
  | { tipo: "sin-ot" };

const COMO_SE_LLAMA: Record<string, string> = {
  POR_HACER: "Por hacer",
  EN_PROCESO: "En proceso",
  ATRASADO: "Atrasada",
};

export function estadoDelTrabajo(
  aviso: {
    work_order_id?: string | null;
    ot_asignada?: string | null;
    desestimado_en?: string | null;
  },
  ot: OtDelAviso | null | undefined
): EstadoDelTrabajo {
  if (ot && ot.ot_number != null) {
    const estado = String(ot.estado ?? "");
    if (estado === "REALIZADO") {
      return { tipo: "cerrado", ot: ot.ot_number, fecha: ot.fecha_cierre ?? null };
    }
    return {
      tipo: "abierto",
      ot: ot.ot_number,
      estado,
      comoSeLlama: COMO_SE_LLAMA[estado] ?? estado,
    };
  }

  const texto = String(aviso.ot_asignada ?? "").trim();
  // Un enlace sin orden legible (ot undefined, o null por un enlace roto) y un
  // texto de planilla se muestran igual: lo que ya había. Sin texto pero con
  // enlace, el aviso igual tiene trabajo: nunca «sin orden».
  if (texto !== "" || aviso.work_order_id) return { tipo: "sin-enlace", texto };

  return { tipo: "sin-ot" };
}

/** Cómo se dice y se pinta el estado de una orden. Lo usan las dos pantallas. */
export interface ComoSeMuestra {
  /** «Cerrada el 6/11», «En proceso», «sin estado»… */
  texto: string;
  /** El color del estado, listo para un `style` (no una utilidad: ver abajo). */
  color: string;
}

/**
 * La voz única de las dos listas de avisos.
 *
 * `/mantenimiento/avisos` y `/mis-avisos` decían cosas distintas del mismo
 * aviso («Cerrada el 6/11» contra «Terminado el 6/11/2026», y el atrasado en
 * rojo sólo de un lado). Gana el vocabulario de Mantenimiento: «Cerrada» es la
 * palabra que el módulo usa para una OT en `REALIZADO`.
 *
 * El color es un valor y no una clase porque `.card` y los `.btn-*` están
 * fuera de toda capa y le ganan a cualquier `text-*` de al lado.
 *
 * Devuelve `null` para `sin-enlace` y `sin-ot`: no son una orden con estado, y
 * cada pantalla los dice con su propio vocabulario a propósito («Ya tiene OT»
 * contra «Con orden de trabajo»).
 *
 * Un estado null es una orden que existe y de la que no se sabe en qué está:
 * se dice «sin estado» y se pinta como abierta, porque «no está cerrada» es lo
 * único cierto.
 */
export function comoSeMuestraElTrabajo(t: EstadoDelTrabajo): ComoSeMuestra | null {
  if (t.tipo === "cerrado") {
    return { texto: t.fecha ? `Cerrada el ${enDiaMes(t.fecha)}` : "Cerrada", color: "#15803D" };
  }
  if (t.tipo === "abierto") {
    return {
      texto: t.comoSeLlama || "sin estado",
      color: t.estado === "ATRASADO" ? "#DC2626" : "#B45309",
    };
  }
  return null;
}
