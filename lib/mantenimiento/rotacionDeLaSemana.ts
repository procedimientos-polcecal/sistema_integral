/**
 * La rotación de una semana del taller, con nombres: lo que dibuja la franja
 * arriba de cada semana del mes en «Asignación RR.HH».
 *
 * Función pura, sin base ni red. Las fechas son ISO "YYYY-MM-DD" y se comparan
 * como strings.
 *
 * ── POR QUÉ LA FRANJA Y NO UN CONTEO ───────────────────────────────────────
 *
 * El pedido original era «los operarios disponibles en cada semana del mes», y
 * medido contra producción el 19/11/2026 ese número **sale constante**: 4
 * mecánicos · 3 electricistas · 1 lubricador las nueve semanas de noviembre y
 * diciembre, y tampoco varía de lunes a domingo. Las dos únicas ausencias y el
 * único franco de esa gente son anteriores al 09/11, el día en que se cargó el
 * padrón, así que no restan nada. Una franja que repite el mismo número nueve
 * semanas seguidas deja de mirarse — es la lección que ya costó el resumen
 * diario de avisos.
 *
 * Lo que **sí** cambia todas las semanas es la rotación: los grupos A y B se
 * dan vuelta entre 4-12 y 12-20 (período 2) y los tres electricistas corren un
 * turno (período 3). Eso es lo que esto arma.
 *
 * ── LA FRANJA ES EL CICLO, Y EL DÍA ES LA VERDAD ───────────────────────────
 *
 * **Las pisadas no ubican a nadie acá, sólo se cuentan.** Una pisada
 * (`mant_programacion_pisadas`) mueve a una persona de turno **un día**, y esta
 * franja habla de **una semana**: ubicar a alguien por su pisada diría de los
 * siete días algo que vale uno solo. Por eso la franja informa cuántos días de
 * esa semana tienen gente movida, y el turno real de un día concreto lo
 * resuelve `turnoDelDia` de `asignarOperario.ts`, que es lo que mira el panel
 * al asignar.
 *
 * Eso también fija contra qué se comprueba: la franja se contrasta contra **el
 * ciclo** que calcula la pestaña «Semana», no contra su grilla final, que lleva
 * las pisadas encima.
 *
 * ── `porTurno: null` NO ES «NO HAY NADIE» ──────────────────────────────────
 *
 * Es «no hay ciclo»: `mant_programacion_referencia` está vacía y no se sabe
 * quién va a qué turno. Los dos son estados distintos y confundirlos haría que
 * una semana sin ancla se vea igual que un taller vacío. Con `null` la pantalla
 * dice que falta cargar la referencia, y **asignar sigue andando**: poner un
 * operario en una OT no depende de saber su turno.
 */

import { semanaDe } from "@/lib/core/fechas";
import {
  estaVigente,
  noViene,
  type AusenciaCruda,
  type FrancoCrudo,
  type PersonaDelTaller,
} from "./disponibilidad";
import {
  comoReferencia,
  laQueRige,
  turnoDeLaPersona,
  type FilaDeReferencia,
} from "./referenciaDelTaller";
import type { Oficio, Turno } from "./programacion";

/** Los tres turnos, en el orden en que se leen. */
export const TURNOS_DE_LA_FRANJA: readonly Turno[] = ["4-12", "8-16", "12-20"];

export interface EnLaFranja {
  empleadoId: string;
  nombre: string;
  oficio: Oficio;
  /** Los días de esa semana en que no viene. Vacío si viene todos. */
  diasQueFalta: string[];
}

export interface FranjaDeLaSemana {
  lunes: string;
  /** null cuando no hay referencia que rija: no hay ciclo que mostrar. */
  porTurno: Record<Turno, EnLaFranja[]> | null;
  /** En el padrón esa semana pero sin turno del ciclo. Nunca se esconden. */
  sinTurno: EnLaFranja[];
  /** Cuántos días de la semana tienen al menos una pisada. */
  diasConPisada: number;
}

/**
 * La franja de la semana que empieza el `lunes`.
 *
 * **Cuenta personas y no filas del padrón**: `mant_personal_taller` no impide
 * dos filas vigentes de la misma persona —cambiar de grupo a mitad de semana
 * deja dos—, y contarlas por fila la mostraría dos veces. Gana la vigencia que
 * rige el lunes, y si no hay ninguna ese día, la primera de la semana: lo que
 * importa es que aparezca una sola vez.
 *
 * Quien no está vigente ningún día de la semana no aparece: no es del taller
 * esa semana.
 */
export function franjaDeLaSemana(
  lunes: string,
  padron: PersonaDelTaller[],
  nombres: Map<string, string>,
  referencias: FilaDeReferencia[],
  ausencias: AusenciaCruda[],
  francos: FrancoCrudo[],
  pisadas: { empleado_id: string; dia: string }[],
): FranjaDeLaSemana {
  const dias = semanaDe(lunes);

  // Una fila por persona: la que vale el lunes, y si no, la primera que valga
  // algún día de la semana.
  const laQueVale = new Map<string, PersonaDelTaller>();
  for (const dia of dias) {
    for (const p of padron) {
      if (!estaVigente(p, dia)) continue;
      if (!laQueVale.has(p.empleadoId)) laQueVale.set(p.empleadoId, p);
    }
  }

  const fila = laQueRige(referencias, lunes);
  const ref = fila ? comoReferencia(fila) : null;

  const enLaFranja = (p: PersonaDelTaller): EnLaFranja => ({
    empleadoId: p.empleadoId,
    nombre: nombres.get(p.empleadoId) ?? "(sin nombre)",
    oficio: p.oficio,
    // Sólo los días en que además es del taller: una persona que entra el
    // miércoles no "falta" el lunes, simplemente no era del taller.
    diasQueFalta: dias.filter(
      (d) =>
        padron.some((q) => q.empleadoId === p.empleadoId && estaVigente(q, d)) &&
        noViene(ausencias, francos, p.empleadoId, d),
    ),
  });

  const porTurno: Record<Turno, EnLaFranja[]> | null = ref
    ? { "4-12": [], "8-16": [], "12-20": [] }
    : null;
  const sinTurno: EnLaFranja[] = [];

  for (const p of laQueVale.values()) {
    const quien = enLaFranja(p);
    const turno = ref ? turnoDeLaPersona(ref, lunes, p) : null;
    if (porTurno && turno) porTurno[turno].push(quien);
    else sinTurno.push(quien);
  }

  const deLaSemana = new Set(dias);
  const diasConPisada = new Set(
    pisadas.map((p) => p.dia).filter((d) => deLaSemana.has(d)),
  ).size;

  return { lunes, porTurno, sinTurno, diasConPisada };
}
