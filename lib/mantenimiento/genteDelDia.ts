/**
 * Cuánta gente del taller hay un día, por oficio: lo que se muestra al lado de
 * cada día del calendario para que quien elige la fecha de una orden vea no sólo
 * cuántas tareas tiene ese día sino si hay alguien para hacerlas.
 *
 * Funciones puras, sin base ni red. Las fechas son ISO "YYYY-MM-DD" y se
 * comparan como strings.
 *
 * **Se cuenta por día y no por turno**, a pedido: «quien esté ese día, en el
 * turno que sea». Los grupos A y B alternan entre 4-12 y 12-20 y nunca van a
 * 8-16 (el encabezado de `programacion.ts` lo dice), y los eventos de la agenda
 * caen a las 08:00: contando por turno, los mecánicos darían cero para siempre
 * —y son 1.764 de las 2.410 órdenes—.
 *
 * Responde dos cosas distintas que no hay que confundir: **cero** («el padrón
 * está cargado y ese día no viene nadie de ese oficio») y **no sé** («el padrón
 * está vacío»). Al 04/11/2026 `mant_personal_taller` tiene cero filas: nadie la
 * cargó, y un cero ahí diría «no hay nadie» sobre un taller que simplemente no
 * está dado de alta. Es el mismo principio de todo el repo: enlazar al que se le
 * parece es peor que dejar en null.
 *
 * Los tipos viven en `programacion.ts` y `disponibilidad.ts`: acá se importan y
 * no se redeclaran, porque dos tipos iguales en dos archivos se separan sin que
 * nada avise.
 */

import { norm } from "@/lib/core/texto";
import {
  estaVigente,
  noViene,
  type AusenciaCruda,
  type FrancoCrudo,
  type PersonaDelTaller,
} from "./disponibilidad";
import type { Oficio } from "./programacion";

/**
 * El oficio del taller que hace una especialidad de OT, o `null` si ninguno.
 *
 * La OT tiene seis especialidades y el padrón tres oficios. CIVIL (279 órdenes)
 * lo hacen contratistas o albañilería, y INSTRUMENTACIÓN y OTRO no tienen a
 * nadie en el padrón: para todas la respuesta honesta es «no usa gente del
 * taller» y no un número. Cualquier texto que no se reconoce también da `null`:
 * asignarle el oficio al que se le parece dejaría la orden contando la gente
 * equivocada, y eso no se nota nunca.
 *
 * Se compara sin tilde ni mayúsculas, porque la celda de la planilla trae
 * `Lubricacion` tanto como `LUBRICACIÓN`.
 */
export function oficioDeLaEspecialidad(
  especialidad: string | null | undefined,
): Oficio | null {
  switch (norm(especialidad)) {
    case "MECANICO":
      return "mecanico";
    case "ELECTRICO":
      return "electricista";
    case "LUBRICACION":
      return "lubricador";
    default:
      return null;
  }
}

export type GenteDelDia =
  /** El padrón está vacío: no se sabe cuánta gente hay, que no es lo mismo que cero. */
  | { sabemos: false }
  | { sabemos: true; porOficio: Record<Oficio, number> };

/**
 * Cuántas personas de cada oficio vienen el día `dia`: las que el padrón tiene
 * vigentes ese día y a las que no les consta una ausencia ni un franco.
 *
 * Usa `noViene`, la misma pregunta que le hace la programación, para que las dos
 * razones —ausencia cargada y franco— no se calculen en dos lugares y digan
 * cosas distintas. De ahí salen las dos reglas que importan: **un franco abre
 * hueco por `fecha_descanso` y nunca por `fecha_tomado`** (los 56 francos
 * viejos tienen `fecha_descanso` en null y no abren nada: el sistema no sabe
 * cuándo descansaron), y **una `TARDANZA` no es falta**.
 *
 * **Se cuentan personas distintas y no filas del padrón**: `mant_personal_taller`
 * no tiene restricción que impida dos filas vigentes de la misma persona, y el
 * padrón se está por cargar por primera vez. Una persona en dos filas del mismo
 * oficio cuenta una; si estuviera en dos oficios, cuenta en cada uno.
 *
 * `sabemos: false` sólo cuando el padrón no tiene a nadie. Un padrón cargado en
 * el que ese día no queda nadie de un oficio sí es un dato, y da cero.
 */
export function genteDelDia(
  padron: PersonaDelTaller[],
  ausencias: AusenciaCruda[],
  francos: FrancoCrudo[],
  dia: string,
): GenteDelDia {
  if (padron.length === 0) return { sabemos: false };

  // Personas y no filas: el esquema no impide dos filas vigentes de la misma
  // persona, y contarlas por fila la duplicaría.
  const personas: Record<Oficio, Set<string>> = {
    mecanico: new Set(),
    electricista: new Set(),
    lubricador: new Set(),
  };
  for (const persona of padron) {
    if (!estaVigente(persona, dia)) continue;
    if (noViene(ausencias, francos, persona.empleadoId, dia)) continue;
    personas[persona.oficio].add(persona.empleadoId);
  }
  const porOficio: Record<Oficio, number> = {
    mecanico: personas.mecanico.size,
    electricista: personas.electricista.size,
    lubricador: personas.lubricador.size,
  };
  return { sabemos: true, porOficio };
}
