/**
 * Qué va a hacer un ciclo encadenado, decidido entero y sin tocar la base.
 *
 * ── POR QUÉ EXISTE, Y POR QUÉ NO ALCANZA `queSigueEnElCiclo()` ──────────────
 *
 * Porque la pantalla de configuración muestra lo que el ciclo va a hacer, y
 * una previsión que no sea **exactamente** lo que decide el generador es peor
 * que no tener previsión: tranquiliza sobre algo que no va a pasar.
 *
 * Y el generador no decide con una función sino con **tres pasos en orden**,
 * donde los dos primeros reescriben `desde`/`vuelta_desde` antes de que el
 * tercero mire nada:
 *
 *   1. `elArranqueDeUnCambio()` — para un ciclo que todavía no arrancó
 *   2. `elCorteQueSigue()`      — para la madre que acaba de cerrarse
 *   3. `queSigueEnElCiclo()`    — la decisión
 *
 * Llamar sólo al tercero discrepa justo en los dos estados que importan:
 *
 * - **Con la madre recién cerrada** diría «espera la OT 3166», mientras el
 *   generador mueve el corte en esa misma corrida y crea la hija siguiente.
 *   No es un caso raro: es el estado de Hidratación al 24/11/2026.
 * - **Con un ciclo sin arrancar cuyo cambio ya se cerró** diría «no arrancó»,
 *   mientras el generador lo arranca.
 *
 * Además dos de los motivos de `trabado` —el equipo dado de baja y la tarea
 * que falta en el catálogo— los producía `generarEncadenadas.ts` por su
 * cuenta, así que las cuatro formas de `Decision` tampoco los cubrían. Sus
 * textos se conservan palabra por palabra: son los que ya se leen en
 * `/administracion/salud`.
 *
 * ── LO QUE DEVUELVE, Y POR QUÉ NO ESCRIBE ──────────────────────────────────
 *
 * `arranque` y `corte` son **lo que habría que escribirle al ciclo**, no algo
 * ya escrito. El generador los persiste; la pantalla los ignora. Esa es toda
 * la diferencia entre los dos llamadores, y es lo que permite que la previsión
 * sea gratis y no tenga efectos.
 */

import {
  queSigueEnElCiclo, elCorteQueSigue,
  type CicloParaDecidir, type Decision, type OTDelCiclo,
} from "./cicloDeOT";
import { elArranqueDeUnCambio, type CerradaParaMirar } from "./sospechaDeCambio";

/** Una de las dos tareas del ciclo, como la trae el catálogo. */
export interface TareaDelCiclo {
  nombre: string;
  componente: string;
  periodo_dias?: number | null;
}

export interface CicloCompleto {
  id: string;
  equipment_id: string;
  repeticiones: number;
  desde: string | null;
  vuelta_desde: number | null;
  /** ISO. El arranque sólo mira cierres posteriores a este día. */
  creado_en: string;
  equipoActivo: boolean;
  equipoCode: string | null;
  madre: TareaDelCiclo | null;
  hija: TareaDelCiclo | null;
}

export interface LoQueHara {
  decision: Decision;
  /** Lo que habría que escribir en el ciclo antes de decidir, o null. */
  arranque: { desde: string; ot_number: number } | null;
  corte: { desde: string; vuelta_desde: number } | null;
  /**
   * El corte **ya movido**: contra esto se decidió. La orden que nace lo
   * escribe adentro como «el último cambio fue el …», así que tiene que salir
   * de acá y no volver a derivarse de `arranque` y `corte` del otro lado —
   * esa segunda derivación es justo lo que esta función existe para evitar.
   */
  alDecidir: { desde: string | null; vuelta_desde: number | null };
}

const trabado = (porque: string): LoQueHara => ({
  decision: { que: "trabado", porque },
  arranque: null,
  corte: null,
  alDecidir: { desde: null, vuelta_desde: null },
});

export function loQueHaraElCiclo(
  ciclo: CicloCompleto,
  suyas: readonly OTDelCiclo[],
  cerradasDelEquipo: readonly CerradaParaMirar[]
): LoQueHara {
  // Un equipo dado de baja no recibe órdenes nuevas. Se dice, en vez de
  // seguir creando trabajo para una máquina que ya no está.
  if (!ciclo.equipoActivo) {
    return trabado(
      `El equipo ${ciclo.equipoCode ?? ""} está inactivo, así que el ciclo no genera órdenes.`
    );
  }

  if (!ciclo.madre || !ciclo.hija) {
    return trabado(
      "Al ciclo le falta la tarea madre o la hija en el catálogo de tareas preventivas."
    );
  }

  const paraDecidir: CicloParaDecidir = {
    id: ciclo.id,
    repeticiones: ciclo.repeticiones,
    periodo_dias: ciclo.hija.periodo_dias ?? null,
    desde: ciclo.desde,
    vuelta_desde: ciclo.vuelta_desde,
  };

  // ── EL ARRANQUE, QUE VIENE DE UN CAMBIO DE PIEZA ──────────────────────────
  //
  // Un ciclo sin arrancar no genera nada, y eso lo vuelve invisible: no hay
  // orden que se atrase, así que `mant-atrasadas-por-fecha` no puede avisarlo.
  // Arranca solo con el primer cambio de la pieza **posterior a su
  // configuración**: hacia adelante y nunca hacia atrás.
  let arranque: LoQueHara["arranque"] = null;
  if (!paraDecidir.desde) {
    arranque = elArranqueDeUnCambio(
      {
        id: ciclo.id,
        equipment_id: ciclo.equipment_id,
        componente: ciclo.hija.componente,
        desdeCuandoMirar: String(ciclo.creado_en).slice(0, 10),
      },
      cerradasDelEquipo
    );

    if (arranque) {
      paraDecidir.desde = arranque.desde;
      paraDecidir.vuelta_desde = 0;
    }
  }

  // ── Primero el corte, y después la decisión ───────────────────────────────
  //
  // En este orden a propósito: la madre que acaba de cerrarse mueve el corte
  // en esta misma corrida, y así la hija 1 nace sin esperar a la siguiente.
  const corte = elCorteQueSigue(paraDecidir, suyas);
  if (corte) {
    paraDecidir.desde = corte.desde;
    paraDecidir.vuelta_desde = corte.vuelta_desde;
  }

  return {
    decision: queSigueEnElCiclo(paraDecidir, suyas),
    arranque,
    corte,
    alDecidir: { desde: paraDecidir.desde, vuelta_desde: paraDecidir.vuelta_desde },
  };
}
