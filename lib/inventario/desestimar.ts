/**
 * Un faltante que alguien decidió no reponer, y cuándo esa decisión caduca.
 *
 * ## Por qué existe
 *
 * «Para reponer» propone comprar lo que tiene faltante y se consumió en los
 * últimos 90 días. A veces la respuesta es que no —el artículo se discontinuó,
 * el mínimo está mal cargado, se reemplazó por otro— y hasta ahora no había
 * forma de decirlo: esa fila se volvía a proponer cada vez que alguien abría la
 * pantalla. Una lista que repite lo que ya se contestó es una lista que se deja
 * de leer, y acá eso importa más que en otras: hoy son **35 filas**, así que
 * tres o cuatro que no corresponden ya son el 10% de lo que se mira.
 *
 * ## Cuándo deja de valer, que es toda la decisión
 *
 * Vuelve a aparecer cuando el artículo **vuelve a tener un movimiento**. La
 * trampa está en qué quiere decir eso, y los datos la muestran: medido el
 * 26/11/2026 sobre los 35 artículos que hoy están para pedir, la mediana del
 * hueco entre dos movimientos consecutivos es de **0,1 días**. Los movimientos
 * llegan en tandas del mismo día, porque así los trae la sincronización de la
 * planilla.
 *
 * Por eso el ancla **no es el instante** en que se desestimó. Si lo fuera, una
 * tanda importada cinco minutos después —con filas de días que ya estaban a la
 * vista— levantaría la desestimación enseguida, y el botón parecería no
 * funcionar. El ancla es `ultimo_movimiento`: el **día** del último movimiento
 * que el artículo tenía cuando se lo desestimó. La decisión vale mientras no
 * aparezca un movimiento de un día posterior a ése.
 *
 * Dicho de otra forma, la pregunta que contesta es «¿pasó algo que yo no había
 * visto?». Un movimiento del mismo día ya estaba contado en la pantalla que se
 * miró.
 *
 * ## Cualquier movimiento, no sólo una salida
 *
 * Una **entrada** también la levanta, aunque parezca lo contrario. Si entró
 * mercadería y el artículo sigue con faltante, lo que se repuso no alcanzó, y
 * eso es exactamente un hecho nuevo sobre el que la decisión de no reponer se
 * tomó sin saberlo. Un **ajuste** igual: corrige el stock, que es el número del
 * que salía el faltante. Lo que no la levanta es el paso del tiempo — un
 * artículo que nadie toca no cambió de situación.
 */

/** Lo que la tabla guarda de un faltante desestimado. */
export interface Desestimacion {
  articulo_id: string;
  /**
   * El día del último movimiento que había al desestimarlo, ISO corto.
   * `null` quiere decir que no tenía ninguno, y entonces cualquiera la levanta.
   */
  ultimo_movimiento: string | null;
  motivo: string | null;
  desestimado_por_nombre: string | null;
  desestimado_en: string;
}

const dia = (v: string | null | undefined) => String(v ?? "").slice(0, 10) || null;

/**
 * Si la decisión de no reponer este artículo **sigue en pie**.
 *
 * `ultimoMovimiento` es el día del movimiento más reciente que tiene hoy,
 * contando los de cualquier tipo. Las dos fechas se comparan como texto ISO,
 * que para `YYYY-MM-DD` ordena igual que como fechas y no mete husos de por
 * medio — que es justo lo que la migración 20260903081542 sacó del kardex.
 */
export function sigueDesestimado(
  desestimacion: Desestimacion | undefined,
  ultimoMovimiento: string | null
): boolean {
  if (!desestimacion) return false;

  const hasta = dia(desestimacion.ultimo_movimiento);
  const ahora = dia(ultimoMovimiento);

  // Sin movimientos de un lado o del otro no hay nada que la levante.
  if (!ahora) return true;
  if (!hasta) return false;

  return ahora <= hasta;
}

/** Las desestimaciones por id de artículo, que es como las busca la pantalla. */
export function desestimacionesPorArticulo(
  filas: Desestimacion[]
): Map<string, Desestimacion> {
  const porId = new Map<string, Desestimacion>();
  for (const f of filas) {
    const id = String(f.articulo_id ?? "").trim();
    if (id) porId.set(id, f);
  }
  return porId;
}

/**
 * Lo que la fila desestimada dice de sí misma.
 *
 * **«Sin motivo» y no un blanco.** Un blanco se lee como «nadie sabe por qué»,
 * y lo que pasó es que nadie lo escribió: el motivo es opcional a propósito,
 * porque obligarlo es la forma más rápida de llenar la tabla de «x».
 */
export function textoDeLaDesestimacion(
  d: Desestimacion,
  comoSeLee: (iso: string) => string
): string {
  const quien = d.desestimado_por_nombre?.trim();
  const cuando = comoSeLee(d.desestimado_en);
  const cabeza = quien ? `Desestimado por ${quien} el ${cuando}` : `Desestimado el ${cuando}`;
  const motivo = d.motivo?.trim();
  return `${cabeza} · ${motivo || "sin motivo"}`;
}
