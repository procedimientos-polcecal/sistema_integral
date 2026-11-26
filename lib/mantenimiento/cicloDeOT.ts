/**
 * Qué OT sigue en un ciclo encadenado, y qué dice.
 *
 * Un ciclo es una **madre** que al cerrarse genera una **hija**, la hija que al
 * cerrarse genera la siguiente, y después de `repeticiones` vueltas la madre de
 * nuevo. El primer caso son los martillos: cambiarlos, rotarlos tres veces,
 * cambiarlos.
 *
 * Esto es **puro**: recibe lo que se leyó y dice qué hacer. Hablar con la base y
 * con Google es de `generarEncadenadas.ts`.
 *
 * ── EL CORTE, QUE ES LO ÚNICO QUE HACE QUE ESTO NO SE ROMPA ─────────────────
 *
 * El estado del ciclo son dos campos: `desde` (la fecha del último trabajo
 * hecho) y `vuelta_desde` (qué vuelta era ése). Y **sólo cuentan las OT del
 * ciclo creadas en `desde` o después**.
 *
 * La primera versión del diseño no tenía ese corte: derivaba el estado de «la
 * última OT del ciclo» y el botón «Se cambiaron los martillos» suspendía la
 * hija que estuviera esperando. Pero entonces la última pasaba a ser la hija
 * **anterior, ya cerrada**, y la corrida siguiente volvía a crear exactamente
 * la orden recién suspendida, fechada sobre un cierre viejo —o sea, nacida
 * atrasada— sobre martillos recién cambiados. Palabra por palabra, lo que quien
 * pidió esto nombró como la razón por la que dejaría de confiar: «que genere OT
 * sobre martillos que ya se cambiaron». El mecanismo que existía para evitar el
 * anti-objetivo lo producía.
 *
 * Con el corte, reiniciar es mover `desde` a hoy y nada más: todo lo anterior
 * queda afuera de una sola vez.
 *
 * ── QUIÉN MUEVE EL CORTE ────────────────────────────────────────────────────
 *
 * Tres puntas y nada más: **la madre al cerrarse**, el botón de reinicio, y la
 * carga inicial. Las tres contestan la misma pregunta —«¿desde cuándo son
 * nuevos estos martillos?»—, que es lo que `desde` quiere decir.
 *
 * Las hijas **no** lo mueven: quedan dentro del rango y la decisión de acá ya
 * las lee bien. Dos mecanismos que hoy dan la misma respuesta son dos que
 * mañana se pueden separar.
 *
 * Y por eso una madre cerrada devuelve `esperar` y no `crear`: lo que
 * desbloquea el ciclo es que alguien mueva el corte, no esta función.
 */

import { comoSeLee, sumarDias } from "@/lib/core/fechas";
import { ESTADO_CANCELADA } from "@/lib/mantenimiento/cancelacion";

export interface CicloParaDecidir {
  id: string;
  /** Cuántas hijas antes de que vuelva la madre. */
  repeticiones: number;
  /**
   * Cada cuántos días. Es el de la **tarea hija** del catálogo, que lo permite
   * en null: se puede confirmar que una tarea existe sin saber su período.
   */
  periodo_dias: number | null;
  /** La fecha del último trabajo hecho. En null, el ciclo no arrancó. */
  desde: string | null;
  vuelta_desde: number | null;
}

export interface OTDelCiclo {
  ot_number: number;
  /** 0 = la madre, 1..n = la hija nº n. */
  ciclo_vuelta: number;
  estado: string | null;
  fecha_cierre: string | null;
  fecha_ejecucion: string | null;
  /** ISO con hora. El corte compara su día contra `desde`. */
  created_at_app: string | null;
}

export type Decision =
  | { que: "crear"; vuelta: number; fecha_ejecucion: string }
  | { que: "esperar"; ot: number }
  | { que: "sin_arrancar" }
  | { que: "trabado"; porque: string };

/** Cerrada de verdad: hecha y con una fecha de cuándo. */
const CERRADA = "REALIZADO";

/**
 * La OT que manda, aplicando el corte.
 *
 * Es la más avanzada de la vuelta, y a igualdad la creada más tarde: el lugar
 * en la vuelta ordena el ciclo, así que una hija 2 creada antes que una hija 3
 * reencolada sigue siendo la anterior.
 *
 * ── LA VUELTA 0 NO ES EL PRINCIPIO: ES EL FINAL ────────────────────────────
 *
 * El ciclo avanza 1 → 2 → … → n y **termina en la madre**, que es la vuelta 0.
 * Ordenar por el número crudo la pone antes de sus propias hijas, y eso costó
 * **426 OT en cuatro días** en PO-C1-04 (Hidratación), del 20 al 24/11/2026:
 * cerrada la hija 3 nació la madre 3166, pero la «última» seguía siendo la
 * hija 3 —vuelta 3 contra vuelta 0—, así que cada corrida del cron volvía a
 * decidir «crear la madre». Una cada diez minutos, hasta la 3594.
 *
 * Y la otra mitad, que lo volvía permanente: `elCorteQueSigue` exige que la
 * última sea la madre para mover el corte, así que **el corte tampoco se movía
 * nunca**. El ciclo no podía ni ver la madre que acababa de crear ni cerrar la
 * vuelta. Las dos mitades se arreglan con este orden.
 *
 * El lugar de la madre se calcula contra **la hija más alta que haya**, y no
 * contra `repeticiones` a secas: ese número se edita en el catálogo, y bajarlo
 * de 4 a 3 con una hija 4 todavía en el rango reabriría exactamente el mismo
 * agujero.
 */
function laUltimaEnRango(
  ciclo: CicloParaDecidir,
  ots: readonly OTDelCiclo[]
): OTDelCiclo | undefined {
  const desde = ciclo.desde;
  if (!desde) return undefined;

  const enRango = ots.filter((o) => {
    if ((o.created_at_app ?? "").slice(0, 10) < desde) return false;
    // La madre que fijó este corte está detrás de él: `desde` **es** su fecha
    // de cierre. Casi siempre queda afuera sola, porque se creó antes de
    // cerrarse; empata sólo cuando se cerró el mismo día que nació, y ahí
    // dejarla adentro la vuelve «la última» para siempre — y una madre cerrada
    // devuelve `esperar`, así que el ciclo se congela. Es el modo de falla
    // silencioso: una OT que no nace tampoco se atrasa, así que nada lo avisa.
    if (o.ciclo_vuelta === 0 && (o.fecha_cierre ?? o.fecha_ejecucion) === desde) return false;
    return true;
  });

  const lugarDeLaMadre =
    Math.max(ciclo.repeticiones, ...enRango.map((o) => o.ciclo_vuelta)) + 1;
  const lugar = (o: OTDelCiclo) => (o.ciclo_vuelta === 0 ? lugarDeLaMadre : o.ciclo_vuelta);

  return [...enRango]
    .sort(
      (a, b) =>
        lugar(a) - lugar(b) ||
        String(a.created_at_app ?? "").localeCompare(String(b.created_at_app ?? ""))
    )
    .at(-1);
}

/**
 * Qué OT sigue, o por qué ninguna.
 *
 * @param ots Las OT **de este ciclo**, en cualquier orden. Se recortan acá.
 */
export function queSigueEnElCiclo(
  ciclo: CicloParaDecidir,
  ots: readonly OTDelCiclo[]
): Decision {
  if (!ciclo.desde || ciclo.vuelta_desde === null || ciclo.vuelta_desde === undefined) {
    return { que: "sin_arrancar" };
  }

  if (!ciclo.periodo_dias || ciclo.periodo_dias <= 0) {
    return {
      que: "trabado",
      porque:
        "La tarea que se repite no dice cada cuántos días, así que no hay de " +
        "dónde sacar la fecha de la orden siguiente. Se carga en el catálogo " +
        "de tareas preventivas del equipo.",
    };
  }

  const ultima = laUltimaEnRango(ciclo, ots);

  if (!ultima) {
    return crearLaSiguiente(ciclo, ciclo.vuelta_desde, ciclo.desde, ots);
  }

  // Decía `SUSPENDIDA`, que salió del vocabulario el 16/11/2026 cuando
  // `CANCELADA` lo reemplazó: la rama quedó muerta y una cancelada caía en el
  // `esperar` de abajo, o sea que el ciclo se quedaba esperando para siempre
  // una orden que ya nadie iba a hacer. Es la trampa exacta que este estado
  // vino a cerrar, entrando por el único lugar que no la miraba.
  //
  // **Trabado y no «crear la siguiente»**, aunque cancelada sea cerrada: de
  // una cancelación no sale ninguna fecha desde la cual contar los días —la
  // regla le prohíbe tener `fecha_cierre`— y, sobre todo, nadie dijo que el
  // ciclo deba seguir. Cancelar una vuelta es un juicio sobre esa orden; si el
  // ciclo sigue o no lo decide una persona, con el botón de reinicio.
  //
  // La que cancela el **propio** reinicio no llega acá: esa ruta le limpia el
  // `ciclo_id`, y lo que entra a esta función son las OT de este ciclo. Lo que
  // esta rama atrapa es una cancelación hecha a mano desde la pantalla de la OT.
  if (ultima.estado === ESTADO_CANCELADA) {
    return {
      que: "trabado",
      porque:
        `La OT ${ultima.ot_number} del ciclo está cancelada, así que no se ` +
        `sabe si había que seguir. Se destraba reiniciando el ciclo desde la ` +
        `ficha del equipo.`,
    };
  }

  if (ultima.estado !== CERRADA) return { que: "esperar", ot: ultima.ot_number };

  // La madre cerrada no genera nada acá: lo que destraba es mover el corte.
  if (ultima.ciclo_vuelta === 0) return { que: "esperar", ot: ultima.ot_number };

  // 168 de 986 REALIZADO históricas no tienen fecha de cierre. Se usa la de
  // ejecución, y si tampoco está se dice en vez de inventar una fecha.
  const cerradaEl = ultima.fecha_cierre ?? ultima.fecha_ejecucion;
  if (!cerradaEl) {
    return {
      que: "trabado",
      porque:
        `La OT ${ultima.ot_number} figura hecha pero no dice cuándo —no tiene ` +
        `fecha de cierre ni de ejecución—, así que no hay desde dónde contar ` +
        `los días de la siguiente.`,
    };
  }

  return crearLaSiguiente(ciclo, ultima.ciclo_vuelta, cerradaEl, ots);
}

/**
 * Adónde hay que mover el corte, o `null` si no hay que moverlo.
 *
 * Es la primera de las tres puntas que lo mueven —las otras dos son el botón de
 * reinicio y la carga inicial— y **sin ella el ciclo se detiene para siempre
 * después del primer cambio**: `queSigueEnElCiclo` devuelve `esperar` sobre una
 * madre cerrada, así que si nadie la saca del rango queda siendo la última para
 * toda la eternidad.
 *
 * Las hijas no mueven nada: quedan dentro del rango y la decisión ya las lee
 * bien. Un segundo mecanismo que hoy da la misma respuesta es uno que mañana se
 * puede separar.
 */
export function elCorteQueSigue(
  ciclo: CicloParaDecidir,
  ots: readonly OTDelCiclo[]
): { desde: string; vuelta_desde: number } | null {
  if (!ciclo.desde) return null;

  const ultima = laUltimaEnRango(ciclo, ots);
  if (!ultima) return null;
  if (ultima.ciclo_vuelta !== 0) return null;
  if (ultima.estado !== CERRADA) return null;

  const cerradaEl = ultima.fecha_cierre ?? ultima.fecha_ejecucion;
  if (!cerradaEl) return null;

  return { desde: cerradaEl, vuelta_desde: 0 };
}

/** Todavía hay trabajo pendiente en esa orden. */
const estaAbierta = (o: OTDelCiclo): boolean =>
  o.estado !== CERRADA && o.estado !== ESTADO_CANCELADA;

/**
 * Después de la vuelta `hecha`, qué toca y cuándo — salvo que esa vuelta ya
 * tenga una orden abierta.
 *
 * ── EL GUARDRAIL, Y POR QUÉ NO MIRA NI EL ORDEN NI EL CORTE ────────────────
 *
 * El 24/11/2026 este ciclo creó 426 órdenes de cambio de martillos en cuatro
 * días porque el orden de `laUltimaEnRango` no reconocía a la madre. Ese
 * defecto está arreglado; esto es la segunda línea, para el próximo.
 *
 * Y la única forma de que una segunda línea sirva es que **no se apoye en nada
 * de lo que puede fallar**: no mira el orden, no mira `desde` y no mira
 * `created_at_app`. Pregunta una sola cosa sobre el dato —¿este ciclo ya tiene
 * una OT abierta para esta vuelta?— y si la hay, espera esa en vez de crear
 * otra. Un guardrail escrito en los mismos términos que la función que vigila
 * se equivoca junto con ella.
 *
 * **Mira todas las OT del ciclo y no sólo las del rango**, que es lo que lo
 * hace valer: una orden abierta de una vuelta anterior significa que ese
 * trabajo no se hizo, y una vuelta nueva no empieza sobre trabajo pendiente.
 * Pasa de verdad cuando el corte se mueve hacia adelante —al cerrarse la madre,
 * o porque alguien lo cargó a mano como se hizo con Planta 0-2— dejando atrás
 * una orden que nadie cerró.
 *
 * Lo cerrado **no** frena: la hija 1 de la vuelta pasada, ya hecha, es
 * exactamente lo normal cuando arranca la siguiente.
 */
function crearLaSiguiente(
  ciclo: CicloParaDecidir,
  hecha: number,
  desdeCuando: string,
  ots: readonly OTDelCiclo[]
): Decision {
  const vuelta = hecha >= ciclo.repeticiones ? 0 : hecha + 1;

  const yaAbierta = ots.find((o) => o.ciclo_vuelta === vuelta && estaAbierta(o));
  if (yaAbierta) return { que: "esperar", ot: yaAbierta.ot_number };

  return {
    que: "crear",
    vuelta,
    fecha_ejecucion: sumarDias(desdeCuando, ciclo.periodo_dias!),
  };
}

/**
 * La cara a la que lleva una vuelta: la vuelta más uno.
 *
 * Los martillos entran nuevos en 1ª cara, así que la primera rotación los lleva
 * a la 2ª. Lo confirman 63 OT del historial que nombran la cara en el texto
 * libre: aparecen la 2ª, la 3ª y la 4ª, **nunca la 1ª y nunca una 5ª**.
 */
export function caraDeLaVuelta(vuelta: number): string {
  return `${vuelta + 1}ª`;
}

/**
 * Lo que dice la orden, incluida la fecha en que se basa.
 *
 * Esa última frase es la defensa que de verdad protege contra el anti-objetivo,
 * y no cuesta nada: si la orden dice «Martillos cambiados el 23/10» y los
 * cambiaron el 05/11, el que la abre lo ve en el acto, sin tener que confiar en
 * el estado interno de nada. Una orden que dice lo que el sistema cree es una
 * orden que se puede desmentir — y la desmiente quien está parado frente a la
 * máquina, que es el único que sabe.
 */
export function descripcionDeLaOT(p: {
  tarea: string;
  componente: string;
  vuelta: number;
  repeticiones: number;
  ultimoCambio: string | null;
}): string {
  const enQue =
    p.vuelta === 0
      ? `las ${p.repeticiones} rotaciones están hechas`
      : `a ${caraDeLaVuelta(p.vuelta)} cara (${p.vuelta} de ${p.repeticiones})`;

  const cambio = p.ultimoCambio
    ? ` ${p.componente} cambiados el ${comoSeLee(p.ultimoCambio)}.`
    : "";

  return `${p.tarea} — ${enQue}.${cambio}`;
}
