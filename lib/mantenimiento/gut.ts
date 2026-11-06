/**
 * La matriz GUT de las órdenes de trabajo: tres notas de 1 a 5 —gravedad,
 * urgencia, tendencia— cuyo producto, de 1 a 125, sirve para ordenarlas.
 * El diseño completo está en
 * docs/superpowers/specs/2026-10-21-mantenimiento-gut-design.md.
 *
 * Todo lo puro del GUT vive acá y nada más: las escalas, el puntaje, la clave
 * de orden, las bandas y el esquema de lo que entra. No toca la base, la red ni
 * React, para que las decisiones se prueben sin levantar nada.
 *
 * LAS TRES VAN JUNTAS O NO VA NINGUNA
 *
 * Hay puntaje sólo con las tres notas. Dos de tres se guardan —alguien puede
 * estar a mitad de camino— pero la orden cuenta como sin puntaje: media
 * puntuación no es media prioridad, es un número que parece una medición y no
 * lo es. Por la misma razón el esquema no obliga a mandar las tres.
 *
 * EL 27, Y POR QUÉ ESTÁ ESCRITO DOS VECES
 *
 * Una orden sin puntaje no vale cero: con cero, las pendientes sin puntuar se
 * irían al fondo de la lista y se quedarían ahí para siempre, porque nadie mira
 * el fondo. Vale 27, que es 3×3×3 —el 3 en cada nota, no el punto medio de 1 a
 * 125, que sería 63—. Queda en el medio del pelotón: ni se cuela arriba ni se
 * hunde, y puntuarla la puede mover para cualquiera de los dos lados.
 *
 * Y el 1000: el máximo posible es 125, así que sumarle 1000 a lo que sigue
 * abierto deja a toda orden abierta por encima de toda cerrada. Sin eso, una
 * realizada de 125 puntos se quedaría arriba de todo para siempre.
 *
 * Los dos números viven también en la columna generada `gut_orden` de
 * `ordenes_trabajo` (migración 20261021104750), porque PostgREST sólo ordena
 * por columnas y el listado se pagina en la base. `claveDeOrdenGut` es su
 * gemela en TypeScript, para el orden que hace el cliente. Cambiar un número en
 * un lado y olvidar el otro no rompe nada y no avisa: el listado y la pestaña
 * ordenarían distinto. Por eso hay un test que reescribe la expresión del SQL
 * a mano, con el 1000 y el 27 como literales, y la compara contra esta función:
 * atrapa que `claveDeOrdenGut` se aparte de la expresión de la migración, en
 * estructura o en valor. Ese test no se refactoriza para usar un ayudante
 * compartido, porque probaría al ayudante contra sí mismo. Lo que ningún test
 * de TypeScript puede ver es el SQL mismo: si los números de la migración
 * cambiaran, nada acá se enteraría. Se sobrevive a eso porque una migración
 * aplicada no se edita en este repo, se corrige con otra.
 */

import { z } from "zod";

/**
 * Las palabras de cada nota, tal cual las trae el material de origen. El
 * índice 0 es la nota 1. No se reescriben "para que suenen mejor": son las que
 * el área ya leyó, y el test las fija.
 */
export const ESCALAS_GUT = {
  gravedad: [
    "No reviste gravedad",
    "Poco grave",
    "Grave",
    "Muy grave",
    "Extremadamente grave",
  ],
  urgencia: [
    "Mucho tiempo disponible",
    "Bastante tiempo disponible",
    "Poco tiempo disponible",
    "Muy poco tiempo disponible",
    "Sin tiempo disponible",
  ],
  tendencia: [
    "No sucederá nada",
    "Empeorará a largo plazo",
    "Empeorará a medio plazo",
    "Empeorará a corto plazo",
    "Empeorará muy rápidamente",
  ],
} as const satisfies Record<string, readonly string[]>;

/**
 * Qué está preguntando cada criterio, para el `(i)` que va al lado de su
 * desplegable en los tres formularios que puntúan.
 *
 * **Las tres dicen lo que el criterio NO es**, y eso es el 90% de para qué
 * sirven. El error que arruina el método es contestar la urgencia y la
 * tendencia mirando lo grave que es: las tres notas terminan diciendo lo
 * mismo, el producto deja de discriminar y el orden vuelve a ser el que ya
 * había. Un 5·5·5 sincero es rarísimo; tres cincos seguidos casi siempre son
 * la misma respuesta escrita tres veces.
 *
 * Está acá y no en cada pantalla porque son tres formularios —alta, puntuar
 * una existente y la que sale de un aviso— y un texto repetido tres veces se
 * corrige en dos.
 */
/**
 * Los nombres de las tres columnas. Sale de `NotasGut` y no de una lista
 * escrita a mano: los tres formularios los repiten en sus tuplas, y una cuarta
 * copia es una que se puede olvidar.
 */
export type CampoGut = keyof NotasGut;

export const AYUDA_GUT: Record<CampoGut, string> = {
  gut_gravedad:
    "Qué pasa si falla: a quién o a qué afecta, y cuánto cuesta. Es lo grave " +
    "que es el problema, no cuándo hay que resolverlo.",
  gut_urgencia:
    "Cuánto podés postergarla sin pagar un precio. El plazo lo fija una parada " +
    "programada, un repuesto que llega, una fecha que no ponés vos o un " +
    "respaldo que te cubre. No es lo grave que es: un trabajo chico puede no " +
    "tener tiempo si la única ventana es hoy.",
  gut_tendencia:
    "Qué tan rápido empeora si no hacés nada. No es el plazo que tenés: algo " +
    "puede empeorar rápido y darte un mes igual, si hay un respaldo andando.",
};

/** Lo que vale para ordenar una orden sin puntaje: 3 × 3 × 3. */
export const SIN_PUNTAJE = 27;

/** Lo que se le suma a lo que sigue abierto: más que el máximo puntaje, 125. */
export const EMPUJON_ABIERTA = 1000;

/**
 * Los estados que ya no esperan nada y van después de lo abierto.
 *
 * Espeja el `case` de la columna generada `gut_orden` (migración
 * 20261021104750): si cambia, hay que escribir una migración nueva. Tiene una
 * gemela con los mismos valores, `CERRADAS` en `alertas.ts`, que NO espeja la
 * migración —sólo decide qué orden está atrasada—. No se unifican: tienen
 * dueños distintos y un estado nuevo (¿"ANULADA"?) se decide en cada una.
 */
export const CERRADAS_GUT: readonly string[] = ["REALIZADO", "SUSPENDIDA"];

/** Desde este puntaje una orden se considera de GUT alto. */
export const ES_ALTO_GUT = 65;

export interface NotasGut {
  gut_gravedad?: number | null;
  gut_urgencia?: number | null;
  gut_tendencia?: number | null;
}

/** El producto de las tres notas, o null si falta cualquiera de ellas. */
export function puntajeGut(notas: NotasGut): number | null {
  const { gut_gravedad: g, gut_urgencia: u, gut_tendencia: t } = notas;
  if (g == null || u == null || t == null) return null;
  return g * u * t;
}

/**
 * La clave con la que se ordena una orden, gemela de `gut_orden` en la base.
 * No es el puntaje y no se muestra nunca: una sin puntaje daría 1027 y una de
 * 5-5-5 daría 1125. Un estado vacío o desconocido cuenta como abierto, igual
 * que el `else` del `case` en SQL: una orden en un estado que nadie previó no
 * se hunde.
 */
export function claveDeOrdenGut(orden: NotasGut & { estado?: string | null }): number {
  const empujon = CERRADAS_GUT.includes(orden.estado ?? "") ? 0 : EMPUJON_ABIERTA;
  return empujon + (puntajeGut(orden) ?? SIN_PUNTAJE);
}

/**
 * Los cortes de las cinco bandas: desde ese puntaje hacia arriba, esa banda.
 * El material de origen las da con agujeros (`79>GUT>64`, `63>GUT>27`…) y deja
 * sin banda a 64, 27, 10 y 1, que son productos posibles; así quedan cerradas,
 * sin solaparse. Lo que no llega al último corte es la banda 1.
 */
const CORTES_DE_BANDA: readonly (readonly [number, 2 | 3 | 4 | 5])[] = [
  [80, 5],
  [65, 4],
  [28, 3],
  [11, 2],
];

/** La banda de un puntaje, de 1 (la más suave) a 5 (la más fuerte). */
export function bandaDeGut(puntaje: number): 1 | 2 | 3 | 4 | 5 {
  for (const [desde, banda] of CORTES_DE_BANDA) {
    if (puntaje >= desde) return banda;
  }
  return 1;
}

/** Si el puntaje llega a 65. Sin puntaje no es alto: no hay nada medido. */
export function esGutAlto(notas: NotasGut): boolean {
  const puntaje = puntajeGut(notas);
  return puntaje !== null && puntaje >= ES_ALTO_GUT;
}

const nota = z.number().int().min(1).max(5).nullable().optional();

/**
 * Lo que entra por una ruta: cada nota es un entero de 1 a 5, nulo, o puede
 * faltar. No se exige que estén las tres —un `null` es como se borra una nota—.
 */
export const esquemaGut = z.object({
  gut_gravedad: nota,
  gut_urgencia: nota,
  gut_tendencia: nota,
});
