/**
 * Un aviso que no va a ser orden de trabajo.
 *
 * Hasta el 21/10/2026 un aviso tenía dos finales: convertirse en OT, o quedar
 * pendiente para siempre. El tercero —«esto no corresponde»— no existía, así
 * que la lista de «sin orden de trabajo» mezclaba lo que falta hacer con lo
 * que ya se decidió no hacer. De 183 avisos, 5 estaban sin OT y dos eran de
 * julio y septiembre: nadie sabía si alguien los había mirado.
 *
 * La práctica ya venía inventando el lugar: la columna `OT ASIGNADA`, que es
 * texto libre, tiene 3 avisos con «Revision», 2 con «-» y uno con «RI 1888».
 *
 * ── DÓNDE SE ESCRIBE, Y POR QUÉ AHÍ ─────────────────────────────────────────
 *
 * **En `OBSERVACIONES` y no en `OT ASIGNADA`.** Las dos razones:
 *
 * 1. `OT ASIGNADA` quiere decir **cuál** orden, y un aviso desestimado no
 *    tiene ninguna. Escribir una palabra ahí hace que el aviso cuente como
 *    «ya tiene OT» —`tieneOt` mira esa columna—, o sea que desaparecería de la
 *    lista por la razón equivocada, y nadie podría distinguir después un aviso
 *    resuelto de uno descartado.
 * 2. `OBSERVACIONES` está **vacía en los 183 avisos**, medido. Es la columna
 *    que existe para esto y que nadie está usando para otra cosa.
 *
 * Al sistema se lo dicen tres columnas —`desestimado_en`, `desestimado_por` y
 * `motivo_desestimado`—, que son las que deciden qué muestra la pantalla. La
 * planilla recibe el texto, que es lo que necesita quien la lee y no entra al
 * sistema.
 */

/** Lo que se sabe al desestimar. */
export interface Desestimacion {
  motivo: string | null | undefined;
  /** "YYYY-MM-DD". Es la fecha del día en Argentina, no la del servidor. */
  cuando: string;
  /** Cómo se llama quien decidió, para que la planilla lo diga. */
  quien: string | null | undefined;
}

/**
 * Qué le falta a una desestimación para poder guardarse.
 *
 * **El motivo no es opcional, y ése es el punto de toda la función.** Un aviso
 * desestimado sin motivo es lo mismo que uno ignorado, sólo que además parece
 * resuelto: desaparece de la lista de pendientes sin que quede dicho por qué,
 * y dentro de tres meses nadie puede saber si fue una decisión o un olvido.
 *
 * Se pide algo que se pueda leer. Un punto o una letra sueltos pasan cualquier
 * comprobación de "no vacío" y no dicen nada; diez caracteres es poco para
 * escribir de más y suficiente para que «no corresponde» entre.
 */
export const MINIMO_DEL_MOTIVO = 10;

export function loQueFaltaParaDesestimar(d: Desestimacion): string[] {
  const motivo = String(d.motivo ?? "").trim();

  if (motivo === "") return ["por qué no va a hacerse"];
  if (motivo.length < MINIMO_DEL_MOTIVO) {
    return [
      `un motivo que se entienda: «${motivo}» no alcanza para que alguien ` +
      `entienda en tres meses por qué este aviso no se hizo`,
    ];
  }
  return [];
}

/**
 * El texto que va a la columna `OBSERVACIONES` de la planilla.
 *
 * Lleva la fecha y quién decidió además del motivo, porque esa celda es todo
 * lo que va a ver quien mire la planilla: ahí no hay a quién preguntarle ni
 * dónde hacer clic. El prefijo es fijo para que se pueda reconocer de un
 * vistazo entre otras observaciones que alguien escriba a mano.
 */
export function observacionDeLaDesestimacion(d: Desestimacion): string {
  const quien = String(d.quien ?? "").trim();
  const cabeza = `Desestimado ${enDiaMes(d.cuando)}${quien ? ` por ${quien}` : ""}`;
  return `${cabeza}: ${String(d.motivo ?? "").trim()}`;
}

/** Si un aviso está desestimado, con lo que el sistema guarda. */
export function estaDesestimado(
  aviso: { desestimado_en?: string | null }
): boolean {
  return Boolean(aviso.desestimado_en);
}

/**
 * Los tres finales posibles de un aviso, en el orden en que se decidieron.
 *
 * Tener OT gana sobre estar desestimado **a propósito**: si alguien lo
 * desestimó y después alguien generó la orden igual, lo que vale es que el
 * trabajo existe. Al revés —mostrarlo desestimado cuando ya hay una OT
 * andando— escondería trabajo en curso.
 */
export type FinalDelAviso = "con-ot" | "desestimado" | "pendiente";

export function finalDelAviso(aviso: {
  work_order_id?: string | null;
  ot_asignada?: string | null;
  desestimado_en?: string | null;
}): FinalDelAviso {
  if (aviso.work_order_id || String(aviso.ot_asignada ?? "").trim()) return "con-ot";
  if (estaDesestimado(aviso)) return "desestimado";
  return "pendiente";
}

/** "2026-10-21" → "21/10". El día y el mes, que es como se nombra una fecha acá. */
function enDiaMes(fecha: string): string {
  const [, mes, dia] = String(fecha ?? "").split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : String(fecha ?? "");
}
