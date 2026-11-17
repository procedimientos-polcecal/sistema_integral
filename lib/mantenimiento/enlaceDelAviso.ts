/**
 * Qué avisos hay que reenlazar a su orden de trabajo, y a cuál.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * Un aviso dice que una máquina anda mal y de él sale una orden de trabajo. El
 * número de esa orden vivía, en 182 de los 238 avisos (medido el 17/11/2026),
 * sólo
 * como **texto** en `ot_asignada` —lo tipeó una persona en una planilla de
 * Google— mientras la columna de verdad, `avisos.work_order_id`, estaba en
 * null. Un script lo resuelve de una vez y la sincronización lo mantiene en
 * cada corrida; esta función es la regla que las dos comparten. No toca la
 * base: recibe lo que ya está leído y dice qué escribir.
 *
 * ── LOS TRES GRUPOS DE `work_order_id` ──────────────────────────────────────
 *
 * Medido contra producción el 17/11/2026 sobre los 238 avisos. **39 tienen
 * `work_order_id`**, y no son todos lo mismo:
 *
 * - **17 los enlazó una persona** con el botón «Ya tiene OT»
 *   (`ot_enlazada_en` puesto). Es una decisión humana, mirada con la orden a
 *   la vista (ver `enlazarOtAlAviso.ts`): la planilla no la pisa, ni aunque el
 *   número cambie.
 * - **22 son OT que el sistema generó desde el aviso** (los dos sellos,
 *   `ot_enlazada_en` y `ot_resuelta_en`, en null). Tampoco se tocan, y **ésta
 *   es la razón de que `aVaciar` exista con tanto cuidado**: el encabezado de
 *   `enlazarOtAlAviso.ts` explica que desenlazar una OT nacida del aviso deja
 *   una orden que nadie reclama y devuelve el aviso a la lista de pendientes,
 *   invitando a que alguien genere una segunda para el mismo problema. Si esta
 *   función los vaciara cuando alguien borra la celda de la planilla, la
 *   sincronización haría callada lo que esa ruta se niega a hacer.
 *
 * Los otros **199 no tienen enlace**, y tampoco son todos lo mismo: **182**
 * traen el número escrito y son los que esta función resuelve, **10** traen un
 * texto que no es un número —«Revision», «-», «1889 - 1886»— que no se
 * interpreta, y **7** no traen nada.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 *
 * Un aviso entra al recálculo sólo si `ot_enlazada_en` es null **y** o bien no
 * tiene `work_order_id`, o bien tiene `ot_resuelta_en` —el sello que marca que
 * el enlace lo puso esta misma resolución a partir del texto—. Es decir: sólo
 * se corrige o se vacía lo que esta regla escribió antes; nunca lo de una
 * persona ni lo que generó el sistema.
 *
 * ── LO QUE NO SE ENLAZA NI SE VACÍA ─────────────────────────────────────────
 *
 * Un número que el mapa no conoce no produce ni enlace ni vaciado. Enlazar al
 * que se le parece es peor que dejar en null, y **vaciar un enlace bueno
 * porque la sincronización de OT corrió a medias** sería peor todavía: el
 * número puede ser válido y la orden no haber llegado aún. Y un texto que no
 * es un número solo (`1889 - 1886`, `RI 1888`) no se adivina: o es un número
 * o no lo es. Sólo si el texto dejó de ser un número —celda vacía, «Revision»—
 * se vacía el enlace automático, porque ahí la planilla dejó de afirmar nada.
 */

export interface AvisoAResolver {
  id: string;
  ot_asignada: string | null;
  work_order_id: string | null;
  ot_enlazada_en?: string | null;
  /** Columna nueva: sello de que este enlace lo escribió la resolución automática. */
  ot_resuelta_en?: string | null;
}

/** El número que la planilla escribió, o null si eso no es un número. */
export function numeroDeOtDelTexto(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  const limpio = texto.trim();
  if (!/^\d+$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isSafeInteger(n) ? n : null;
}

export interface LoQueHayQueReenlazar {
  /** Un grupo por OT: a esos avisos se les escribe ese `work_order_id`. */
  aEnlazar: { otId: string; avisoIds: string[] }[];
  /** Avisos a los que hay que vaciarles el enlace automático. */
  aVaciar: string[];
}

export function loQueHayQueReenlazar(
  avisos: readonly AvisoAResolver[],
  idPorNumero: ReadonlyMap<number, string>
): LoQueHayQueReenlazar {
  const grupos = new Map<string, string[]>();
  const aVaciar: string[] = [];

  for (const aviso of avisos) {
    // De una persona: no se toca nunca.
    if (aviso.ot_enlazada_en) continue;
    // Enlazado y sin sello: nació de este aviso, y no se desenlaza.
    if (aviso.work_order_id && !aviso.ot_resuelta_en) continue;

    const numero = numeroDeOtDelTexto(aviso.ot_asignada);

    if (numero === null) {
      // Si no hay nada enlazado, no hay nada que vaciar. Si lo hay, es nuestro.
      if (aviso.work_order_id) aVaciar.push(aviso.id);
      continue;
    }

    const otId = idPorNumero.get(numero);
    if (!otId) continue; // número desconocido: ni enlace ni vaciado
    if (otId === aviso.work_order_id) continue; // ya es el que corresponde

    const lista = grupos.get(otId);
    if (lista) lista.push(aviso.id);
    else grupos.set(otId, [aviso.id]);
  }

  return {
    aEnlazar: [...grupos].map(([otId, avisoIds]) => ({ otId, avisoIds })),
    aVaciar,
  };
}
