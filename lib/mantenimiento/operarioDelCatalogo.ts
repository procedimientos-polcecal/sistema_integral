/**
 * De un nombre del catálogo `operarios` a una persona del padrón del taller.
 *
 * Función pura, sin base ni red.
 *
 * ── POR QUÉ EL CATÁLOGO MANDA, Y NO EL PADRÓN ──────────────────────────────
 *
 * Las tres columnas de operario de la OT (`operario_1/2/3`, que son la P, la Q
 * y la R del master) ya tienen un vocabulario curado: la tabla `operarios`, con
 * diez nombres repartidos en tres posiciones, que es lo que ofrece el
 * desplegable al registrar el trabajo. Medido el 19/11/2026 sobre las últimas
 * 1.000 OT: **1.223 menciones de 1.223 están en la columna que el catálogo les
 * asigna, cero fuera**. Eso no es una preferencia del formulario, es cómo se
 * llenó la planilla siempre.
 *
 * Así que el panel de asignación escribe **el `nombre` del catálogo tal cual**,
 * sin tocarle una letra: un vocabulario y no dos para las mismas tres celdas.
 * Una versión anterior del diseño inventaba un formato propio —`Aguirre,
 * Gabriel`— para desambiguar apellidos contra los 71 empleados; se descartó
 * porque el desplegable del cierre no habría ofrecido lo que el panel asignó.
 *
 * ── LO QUE NO SE PUEDE SABER, NO SE ADIVINA ────────────────────────────────
 *
 * Para saber si alguien está disponible hay que saber **quién es**, y eso se
 * resuelve cruzando el nombre del catálogo con el padrón. Medido el mismo día:
 * **7 de los 10 resuelven a exactamente una persona**. Los otros tres casos no
 * se adivinan, se dicen:
 *
 * - **«Ambos»** no es una persona, es la palabra «ambos».
 * - **«Lopez»** es Raúl Argentino López, que todavía no está en el padrón.
 * - **«Lucas»** cae en GALLASTEGUI y en MENDIZABAL, los dos del taller.
 *
 * Los tres se ofrecen igual —si no, no se podría asignar a López, que es el
 * tercer nombre más cargado de todos con 220 menciones— y la pantalla dice por
 * qué no sabe si vienen. Es la regla de todo el repo: enlazar al que se le
 * parece es peor que dejar en null, porque un enlace equivocado no se nota
 * nunca.
 *
 * **Los dos últimos se cierran con datos y no con código**: cargar a López en
 * `mant_personal_taller`, y desambiguar «Lucas» en el catálogo. El día que eso
 * pase, esta función empieza a resolverlos sola y la pantalla mejora sin que
 * nadie toque nada — hay un test que lo fija.
 *
 * Y lo que se ve mirándolo por el otro lado, que es lo que de verdad cuesta:
 * **LUCAS GALLASTEGUI es la única persona del padrón a la que ningún nombre del
 * catálogo alcanza sin ambigüedad**, así que hoy no se le puede asignar nada.
 * Desambiguar «Lucas» no es prolijidad: es la diferencia entre poder darle
 * trabajo y no.
 */

import { norm } from "@/lib/core/texto";
import type { PersonaDelTaller } from "./disponibilidad";
import type { Oficio } from "./programacion";

/** Por qué no se puede saber la disponibilidad de un nombre del catálogo. */
export type PorQueNoSeSabe = "no-esta-en-el-padron" | "nombra-a-mas-de-uno";

export interface OperarioDelCatalogo {
  /** Lo que se escribe en la celda, tal cual sale del catálogo. */
  nombre: string;
  /** 1, 2 o 3: la columna en la que ese nombre puede ir. */
  slot: number;
  /** La persona del padrón, o null con el motivo al lado. */
  empleadoId: string | null;
  porQueNoSeSabe: PorQueNoSeSabe | null;
  /**
   * El oficio de esa persona, para poder ofrecer primero al que la OT pide.
   * `null` cuando el nombre no resolvió: inventarle un oficio sería lo mismo
   * que enlazarlo con quien se le parece.
   */
  oficio: Oficio | null;
}

/**
 * Cada fila del catálogo con la persona que nombra, o con el motivo por el que
 * no se sabe.
 *
 * Un nombre resuelve cuando el nombre completo de **exactamente una** persona
 * del padrón lo contiene, comparando sin tildes ni mayúsculas (`norm`): la
 * planilla escribe «Echeverria» y la ficha dice «NESTOR DANIEL ECHEVERRÍA».
 *
 * **Se cuentan personas y no filas del padrón**: `mant_personal_taller` no
 * impide dos filas vigentes de la misma persona —cambiar de grupo deja dos—, y
 * contarlas por fila volvería ambiguo un nombre que no lo es.
 */
export function resolverElCatalogo(
  catalogo: { slot: number; nombre: string }[],
  padron: PersonaDelTaller[],
  nombres: Map<string, string>,
): OperarioDelCatalogo[] {
  // Una entrada por persona, con el oficio de su primera fila: el oficio sólo
  // ordena la lista, así que la vigencia exacta no cambia nada acá.
  const delTaller = new Map<string, Oficio>();
  for (const p of padron) if (!delTaller.has(p.empleadoId)) delTaller.set(p.empleadoId, p.oficio);

  return catalogo.map(({ slot, nombre }) => {
    const buscado = norm(nombre);
    const caen = [...delTaller.keys()].filter((id) =>
      norm(nombres.get(id) ?? "").includes(buscado),
    );

    if (caen.length === 1) {
      return {
        nombre,
        slot,
        empleadoId: caen[0],
        porQueNoSeSabe: null,
        oficio: delTaller.get(caen[0]) ?? null,
      };
    }

    return {
      nombre,
      slot,
      empleadoId: null,
      porQueNoSeSabe: caen.length === 0 ? "no-esta-en-el-padron" : "nombra-a-mas-de-uno",
      oficio: null,
    };
  });
}

/** Lo que la pantalla dice cuando no se sabe si esa persona viene. */
export function comoSeDice(porQue: PorQueNoSeSabe): string {
  return porQue === "no-esta-en-el-padron"
    ? "no está en el padrón del taller"
    : "ese nombre es de más de una persona del taller";
}
