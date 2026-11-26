/**
 * La rotación que resultó ser un cambio: las reglas y los dos textos.
 *
 * Un ciclo encadenado pide rotar los martillos a la 3ª cara. En la máquina no
 * se rota: se cambian enteros. Esa OT no se puede cerrar —cerrarla diría que se
 * hizo algo que no se hizo— y el ciclo la espera para siempre. Esto es lo puro
 * del botón que la resuelve: qué impide registrar el cambio, qué dice la orden
 * nueva, qué dice la rotación que se cancela, y qué otras órdenes dejan de
 * pertenecerle al ciclo.
 *
 * Que esto sea el caso normal y no el raro está medido: entre cambio y cambio
 * de martillos, sobre **70 intervalos** en los cuatro equipos, **60 tuvieron
 * menos de las 3 rotaciones esperadas** y 21 tuvieron cero (26/11/2026).
 *
 * ── POR QUÉ LA RUTA MUEVE EL CORTE, Y NO SE LO DEJA AL GENERADOR ───────────
 *
 * Es la parte de este mecanismo que no se deduce leyendo el código, y la que
 * produce el anti-objetivo —«generar OT sobre martillos que ya se cambiaron»—
 * sin un solo error si alguien la simplifica.
 *
 * Lo natural sería no tocar el corte: una madre cerrada es lo que lo mueve, y
 * `elCorteQueSigue` lo haría solo en la corrida siguiente. No alcanza, porque
 * `laUltimaEnRango` recorta por **`created_at_app`** —cuándo se creó la fila— y
 * no por la fecha del trabajo, y además excluye siempre a la madre cuyo cierre
 * empata con el corte. Acá la madre **nace hoy con un cierre en el pasado**,
 * que es justo la combinación que ese recorte no previó. Con `C` = fecha del
 * cambio y `D0` = corte viejo:
 *
 *   · `C === D0` → la madre queda excluida de entrada, el corte no se mueve
 *     nunca, y la última en rango vuelve a ser la hija cerrada anterior: el
 *     ciclo **recrea la rotación que se acaba de cancelar**.
 *   · `C` anterior al `created_at_app` de una hija cerrada que siga en el ciclo
 *     → el corte se mueve a `C`, pero esa hija queda en rango y pasa a ser la
 *     última: el ciclo crea la **vuelta siguiente**, ya atrasada.
 *
 * Por eso la ruta deja `desde = C`, `vuelta_desde = 0` y saca del ciclo lo que
 * `lasQueSalenDelCiclo` nombra. No inventa una punta nueva: de las tres que
 * pueden mover el corte —la madre al cerrarse, el botón de reinicio y la carga
 * inicial— ésta es la misma que el reinicio, alguien afirmando desde cuándo son
 * nuevos estos martillos.
 *
 * El diseño completo está en
 * `docs/superpowers/specs/2026-11-26-mantenimiento-la-rotacion-que-fue-un-cambio-design.md`.
 */

import { comoSeLee } from "@/lib/core/fechas";
import { ESTADO_CANCELADA } from "@/lib/mantenimiento/cancelacion";
import { caraDeLaVuelta } from "@/lib/mantenimiento/cicloDeOT";

/** La OT de rotación sobre la que se aprieta el botón. */
export interface RotacionAResolver {
  id: string;
  ot_number: number | null;
  ciclo_id: string | null;
  /** 0 = la madre, 1..n = la hija nº n. */
  ciclo_vuelta: number | null;
  estado: string | null;
}

export interface CicloDelCambio {
  repeticiones: number;
  /** La fecha del último trabajo registrado. Es el piso de la fecha nueva. */
  desde: string | null;
  tareaMadre: string;
  tareaHija: string;
  componente: string;
}

/** Lo que llega del formulario, sin confiar en su forma. */
export interface DatosDelCambio {
  fecha: unknown;
  horas?: unknown;
  operario_1?: unknown;
  operario_2?: unknown;
  operario_3?: unknown;
}

const ES_UNA_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Cerrada de verdad: hecha, o decidido que no se hace. */
const estaCerrada = (estado: string | null): boolean =>
  estado === "REALIZADO" || estado === ESTADO_CANCELADA;

/** Si lo que vino en ese campo es algo, o está vacío. */
const vino = (v: unknown): boolean =>
  v !== undefined && v !== null && String(v).trim() !== "";

/**
 * Todos los problemas juntos y en castellano, como el resto del sistema: de a
 * uno obliga a descubrirlos por turnos.
 *
 * `hoy` entra por parámetro y no se lee acá para que esto siga siendo puro: la
 * ruta le pasa `hoyEnArgentina()`.
 */
export function loQueImpideRegistrarElCambio(
  orden: RotacionAResolver,
  ciclo: CicloDelCambio,
  datos: DatosDelCambio,
  hoy: string,
): string[] {
  const problemas: string[] = [];

  // Las tres de la orden. El cliente ya filtra el botón, pero un POST armado a
  // mano llega igual y lo que haría es crear una segunda orden de cambio.
  if (!orden.ciclo_id) {
    problemas.push(
      "Esa orden no pertenece a ningún ciclo, así que no hay ninguna rotación " +
      "que reemplazar."
    );
  } else if (!orden.ciclo_vuelta) {
    problemas.push(
      `Esa orden ya es ${ciclo.tareaMadre.toLowerCase()}, no una rotación.`
    );
  }

  if (estaCerrada(orden.estado)) {
    problemas.push(
      `La OT ${orden.ot_number ?? "—"} ya está cerrada: puede que alguien la ` +
      "haya resuelto desde otra pantalla. Actualizá y mirá cómo quedó."
    );
  }

  const fecha = String(datos.fecha ?? "").trim();

  if (!fecha) {
    problemas.push(
      `Falta decir cuándo se cambiaron ${ciclo.componente.toLowerCase()}: de ` +
      "esa fecha sale la rotación siguiente."
    );
  } else if (!ES_UNA_FECHA.test(fecha)) {
    problemas.push("La fecha del cambio tiene que ser un día del calendario.");
  } else if (fecha > hoy) {
    problemas.push(
      "No se puede registrar un cambio con fecha futura: todavía no pasó."
    );
  } else if (ciclo.desde && fecha < ciclo.desde) {
    problemas.push(
      `El último cambio registrado es del ${comoSeLee(ciclo.desde)}. Una fecha ` +
      "anterior haría que el ciclo volviera atrás y pidiera rotaciones ya hechas."
    );
  }

  if (vino(datos.horas)) {
    const n = Number(datos.horas);
    if (!Number.isFinite(n) || n < 0) {
      problemas.push("Las horas tienen que ser un número de cero para arriba.");
    }
  }

  return problemas;
}

/**
 * Lo que dice la orden del cambio.
 *
 * **No sale de `descripcionDeLaOT`**, que para la vuelta 0 escribe «las 3
 * rotaciones están hechas»: acá es falso por construcción, porque el cambio se
 * hizo justamente antes de que una rotación tocara. Una orden que miente es
 * peor que una sin descripción, y ésta se lee meses después en el master.
 */
export function descripcionDelCambio(
  ciclo: CicloDelCambio,
  orden: RotacionAResolver,
): string {
  const vuelta = orden.ciclo_vuelta ?? 0;
  const cual = orden.ot_number ? ` en la OT ${orden.ot_number}` : "";

  return (
    `${ciclo.tareaMadre} — se hizo antes de la rotación a ` +
    `${caraDeLaVuelta(vuelta)} cara (${vuelta} de ${ciclo.repeticiones}), ` +
    `que quedó cancelada${cual}.`
  );
}

/**
 * El motivo que queda escrito en la rotación que se cancela.
 *
 * **Nombra la orden del cambio**, que es lo que el texto del botón de reinicio
 * no hace: ahí dice «el ciclo se reinició» y no deja de dónde agarrarse para
 * encontrar el trabajo que sí se hizo.
 */
export function elMotivoDeLaRotacion(
  ciclo: CicloDelCambio,
  fecha: string,
  otDelCambio: number,
): string {
  return (
    `Los ${ciclo.componente.toLowerCase()} se cambiaron el ${comoSeLee(fecha)}, ` +
    "antes de que tocara esta rotación. Quedó registrado en la OT " +
    `${otDelCambio} y esta orden ya no corresponde.`
  );
}

/**
 * Las OT que dejan de pertenecerle al ciclo.
 *
 * Una orden del ciclo nacida **después** del cambio habla de martillos que ya
 * no están, y una hija cerrada después de esa fecha además contradice al propio
 * cambio. Las anteriores conservan su `ciclo_id` y su `ciclo_vuelta`, que es lo
 * que deja contestar después cuántas rotaciones produjo cada vuelta.
 *
 * El recorte es por **día** y no por instante, igual que `laUltimaEnRango`: es
 * la misma comparación, vista desde el otro lado.
 *
 * `yaResueltas` son las que la ruta toca por su cuenta —la rotación que se
 * cancela y la orden recién creada—, para no escribirlas dos veces.
 */
export function lasQueSalenDelCiclo(
  ots: readonly { id: string; created_at_app: string | null }[],
  fechaDelCambio: string,
  yaResueltas: readonly string[],
): string[] {
  const resueltas = new Set(yaResueltas);

  return ots
    .filter((o) => !resueltas.has(o.id))
    .filter((o) => (o.created_at_app ?? "").slice(0, 10) >= fechaDelCambio)
    .map((o) => o.id);
}
