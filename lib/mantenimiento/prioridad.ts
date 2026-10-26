/**
 * En qué orden conviene hacer las órdenes de trabajo.
 *
 * Hay dos órdenes y el manual gana: el sugerido sale de lo que dicen los datos
 * —qué está atrasado, qué es urgente, qué espera hace más— y el manual sale de
 * lo que sabe quien reparte el trabajo, que a veces es otra cosa: que el
 * repuesto llega el jueves, que hay que aprovechar que el sector está parado.
 *
 * Se ordenan **las pendientes**, no todas. De las 1.741 órdenes cargadas hay 32
 * esperando algo; poner en fila las 1.709 que ya se hicieron no le sirve a
 * nadie.
 */

import { estaAtrasada, type Atrasable } from "@/lib/mantenimiento/alertas";
import { claveDeOrdenGut, puntajeGut, type NotasGut } from "@/lib/mantenimiento/gut";
import { PRIORIDADES_DE_OT } from "@/lib/mantenimiento/filtrosOt";

/** Los estados en los que la orden todavía espera algo de alguien. */
export const ESTA_PENDIENTE = ["ATRASADO", "EN_PROCESO", "POR_HACER"] as const;

/**
 * La prioridad, reducida a la palabra.
 *
 * La planilla la escribe con un emoji adelante —"🟠 Alta", "🟡 Media"— y así se
 * guarda, porque es lo que dice la celda. Comparar eso contra "ALTA" no
 * coincidía nunca. Antes servía para pesar el orden sugerido; desde el
 * 21/10/2026 ese peso lo reemplazó el GUT y sólo la usa
 * `prioridadParaLaPlanilla`, para reconocer la palabra detrás del adorno.
 *
 * Se descarta todo lo que no sea una letra: el emoji, el espacio y los acentos.
 * Así entra "🟠 Alta", "ALTA", "alta" y lo que venga mañana con otro adorno.
 */
const soloLaPalabra = (v: unknown): string =>
  String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z]/g, "");

/** Cómo escribe cada prioridad la planilla, que es el vocabulario de la casa. */
const COMO_LA_ESCRIBE_LA_PLANILLA: Record<string, string> = {
  ALTA: "🟠 Alta",
  MEDIA: "🟡 Media",
  BAJA: "🟢 Baja",
};

/**
 * La prioridad en el vocabulario de la planilla.
 *
 * EL BUG DEL 16/10/2026. `NuevaOTModal` tenía su propia copia del vocabulario
 * —`["ALTA", "MEDIA", "BAJA"]`— y el alta lo escribía tal cual. La planilla
 * dice `"🟡 Media"` en sus 130 filas con prioridad, y el filtro del listado usa
 * esa forma, así que **una OT creada desde la app no aparecía al filtrar por
 * «Media»**. Quedaron 36 filas diciendo `"🟡 Media"` y una sola `"MEDIA"`.
 *
 * Es el mismo caso que el estado, que sí se traduce al escribir —la app guarda
 * `EN_PROCESO` y la planilla dice "En proceso"—. A la prioridad le faltaba, y
 * no se notaba porque una OT que falta en un filtro se lee como "no hay
 * ninguna".
 *
 * Se aplica **antes de guardar**, no al leer: así la base queda con una sola
 * forma y el filtro puede seguir siendo un `.in()` liso. Lo que no reconocemos
 * pasa tal cual, igual que hace el estado con `EN_LA_PLANILLA[v] ?? v`:
 * inventarle un emoji sería decidir por la planilla, y perderlo sería peor.
 */
export function prioridadParaLaPlanilla(valor: unknown): string | null {
  const palabra = soloLaPalabra(valor);
  if (!palabra) return null;
  return COMO_LA_ESCRIBE_LA_PLANILLA[palabra] ?? (String(valor).trim() || null);
}

/* ── La prioridad que sale del GUT ──────────────────────────────────────── */

/**
 * Los dos cortes que convierten un puntaje GUT en una de las tres prioridades.
 *
 * Pedidos así el 23/10/2026: **más de 80 es Alta, de 30 a 80 es Media, menos de
 * 30 es Baja.** Son los únicos dos números de esta traducción y viven acá y en
 * ningún otro lado — la migración `20261023113310` guarda el producto y no la
 * palabra justamente para que no haya una segunda copia en SQL.
 *
 * Dos cosas que conviene saber al mirarlos, porque no se deducen del número:
 *
 * - El GUT es el producto de tres notas de 1 a 5, así que **no es un continuo**:
 *   entre 81 y 99 no hay ningún producto posible. Con el corte en "más de 80",
 *   Alta son exactamente los puntajes **100 (4·5·5) y 125 (5·5·5)**.
 * - El 80 exacto (4·4·5) cae en Media, aunque `bandaDeGut` lo llame banda 5.
 *   Las bandas y las prioridades son dos escalas distintas y no tienen por qué
 *   coincidir; si algún día tienen que hacerlo, se mueve el `>` a `>=` acá.
 */
export const CORTE_DE_PRIORIDAD = { alta: 80, media: 30 } as const;

/** Las tres, con el emoji que les pone la planilla. */
export const PRIORIDAD_ALTA = COMO_LA_ESCRIBE_LA_PLANILLA.ALTA;
export const PRIORIDAD_MEDIA = COMO_LA_ESCRIBE_LA_PLANILLA.MEDIA;
export const PRIORIDAD_BAJA = COMO_LA_ESCRIBE_LA_PLANILLA.BAJA;

/**
 * Qué prioridad le corresponde a un puntaje GUT.
 *
 * Devuelve la forma de la planilla —"🟠 Alta"— y no la palabra pelada, porque
 * es la que el filtro compara y la que la pantalla muestra. Una sola forma.
 */
export function prioridadDeGut(puntaje: number): string {
  if (puntaje > CORTE_DE_PRIORIDAD.alta) return PRIORIDAD_ALTA;
  if (puntaje >= CORTE_DE_PRIORIDAD.media) return PRIORIDAD_MEDIA;
  return PRIORIDAD_BAJA;
}

/**
 * La prioridad que vale para una orden: **el GUT manda**.
 *
 * Si tiene las tres notas, la prioridad sale del puntaje aunque la celda de la
 * planilla diga otra cosa. Si no las tiene, vale lo que diga la planilla; y si
 * tampoco hay eso, `null`.
 *
 * Se decidió así a pedido, el 23/10/2026, sabiendo lo que cuesta: en una orden
 * puntuada, **la app va a mostrar una prioridad distinta de la que dice su
 * planilla**, y nada lo avisa. Se acepta porque la prioridad de la planilla
 * casi no existe —2.081 de 2.264 órdenes no la tienen— y porque el GUT es una
 * medición con tres notas detrás, mientras que la otra es una palabra suelta
 * que alguien escribió.
 */
export function prioridadEfectiva(
  orden: NotasGut & { prioridad?: string | null }
): string | null {
  const puntaje = puntajeGut(orden);
  if (puntaje !== null) return prioridadDeGut(puntaje);
  return String(orden.prioridad ?? "").trim() || null;
}

/**
 * El rango de puntajes de cada prioridad, como lo entiende PostgREST.
 *
 * Es un `Record` tipado **contra `PRIORIDADES_DE_OT`**, así que agregar una
 * prioridad sin decir qué puntajes le tocan deja de compilar. Es la lección del
 * 22/10/2026, cuando el filtro de tipos mostró «Correctivo» tres veces porque
 * un ternario se tragó los valores nuevos.
 *
 * Un `null` no entra en ninguno de los tres: en SQL `null > 80` no es verdadero
 * sino nulo, así que una orden sin puntaje no cae en ningún rango por accidente
 * — que es justo lo que se quiere, porque a ésa la decide la planilla.
 */
const RANGO_DE_PRIORIDAD: Record<(typeof PRIORIDADES_DE_OT)[number], string> = {
  "🟠 Alta": `gut_puntaje.gt.${CORTE_DE_PRIORIDAD.alta}`,
  "🟡 Media": `and(gut_puntaje.gte.${CORTE_DE_PRIORIDAD.media},gut_puntaje.lte.${CORTE_DE_PRIORIDAD.alta})`,
  "🟢 Baja": `gut_puntaje.lt.${CORTE_DE_PRIORIDAD.media}`,
};

/**
 * El filtro que hay que mandarle a PostgREST para "estas prioridades",
 * contando el GUT. `null` si no se eligió ninguna.
 *
 * **Por qué no es un `.in()` liso como los otros filtros.** Porque desde el
 * 23/10 la prioridad de una orden puntuada no está en ninguna columna de texto:
 * sale de su puntaje. Y el listado se pagina en la base —2.264 filas de a 50—,
 * así que esto tiene que resolverse allá: filtrar en el cliente filtraría sólo
 * la página que se está mirando, y la orden más urgente podría estar en la 40.
 *
 * Lo que arma es un `or` de dos clases de condición:
 *
 *   - los rangos de puntaje de las prioridades elegidas, para las puntuadas;
 *   - y `gut_puntaje is null and prioridad in (…)`, para las que no tienen
 *     puntaje y se deciden por lo que diga la planilla.
 *
 * Los valores van entre comillas dobles porque llevan un emoji y un espacio, y
 * un `in.()` sin comillas los parte.
 */
export function filtroDePrioridadConGut(elegidas: readonly string[]): string | null {
  const quiere = [...new Set(elegidas.map((p) => String(p ?? "").trim()).filter(Boolean))];
  if (quiere.length === 0) return null;

  const partes = quiere
    .map((p) => RANGO_DE_PRIORIDAD[p as (typeof PRIORIDADES_DE_OT)[number]])
    .filter(Boolean);

  // Las que nadie puntuó: manda la planilla. Va siempre, porque cualquiera de
  // las tres elegidas puede estar escrita en esa celda.
  partes.push(`and(gut_puntaje.is.null,prioridad.in.(${quiere.map((p) => `"${p}"`).join(",")}))`);

  return partes.join(",");
}

export interface Ordenable extends Atrasable, NotasGut {
  id: string;
  ot_number?: number | null;
  prioridad?: string | null;
  fecha?: string | null;
  orden_manual?: number | null;
}

/**
 * El orden que sugieren los datos.
 *
 * Primero lo atrasado —ya se pasó de fecha, no importa con qué puntaje
 * nació—, después lo de más puntaje GUT, y entre iguales lo que espera hace más.
 *
 * La columna `prioridad` (ALTA/MEDIA/BAJA) ya no ordena: el 92% de las órdenes
 * nunca la tuvo y el GUT la reemplaza.
 */
export function ordenSugerido<T extends Ordenable>(ordenes: T[], hoy: string): T[] {
  return [...ordenes].sort((a, b) => {
    const atrasoA = estaAtrasada(a, hoy) ? 1 : 0;
    const atrasoB = estaAtrasada(b, hoy) ? 1 : 0;
    if (atrasoA !== atrasoB) return atrasoB - atrasoA;

    // Se compara la clave entera de `claveDeOrdenGut` y no sólo el puntaje, a
    // propósito: la clave lleva las dos decisiones del orden —lo cerrado va
    // después de lo abierto (+1000) y lo que no tiene puntaje vale 27 y no 0—.
    // Con sólo el puntaje esto andaba únicamente porque hoy la única fuente
    // (`?pendientes=1`) trae los tres estados abiertos; alimentada con otra
    // cosa, una REALIZADO de 125 pasaría por delante de una abierta, que es justo lo que el
    // +1000 existe para impedir. (Sin puntaje, o con dos notas de tres, la
    // clave suma 27: `puntajeGut` da null.)
    const clave = claveDeOrdenGut(b) - claveDeOrdenGut(a);
    if (clave !== 0) return clave;

    // La más vieja primero. Las fechas `aaaa-mm-dd` se comparan como texto.
    return String(a.fecha ?? "").localeCompare(String(b.fecha ?? ""));
  });
}

/**
 * Mueve un elemento de una posición a otra.
 *
 * Devuelve una lista nueva: la que está en pantalla se reemplaza entera, y
 * mutar la de React deja la vista sin actualizar.
 */
export function moverEnLista<T>(lista: T[], desde: number, hasta: number): T[] {
  if (
    desde === hasta ||
    desde < 0 || desde >= lista.length ||
    hasta < 0 || hasta >= lista.length
  ) {
    return lista;
  }

  const copia = [...lista];
  const [movido] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movido);
  return copia;
}

/** La lista tal como quedó, lista para guardar. */
export function asignarOrden(lista: { id: string }[]): { id: string; orden: number }[] {
  return lista.map((o, i) => ({ id: o.id, orden: i }));
}

/**
 * El orden final: primero lo que alguien puso a mano, después el resto.
 *
 * Las que nadie ordenó van después y entre ellas vale el orden sugerido. Así
 * poner tres órdenes arriba no obliga a ordenar las otras veintinueve.
 *
 * Si dos quedaron con el mismo número —pasa al ordenar una lista filtrada,
 * porque las de afuera conservan el suyo— desempata el número de OT, que es
 * estable y no depende de en qué orden llegaron.
 */
export function aplicarOrdenManual<T extends Ordenable>(ordenes: T[], hoy: string): T[] {
  const sugerido = ordenSugerido(ordenes, hoy);
  const posicion = new Map(sugerido.map((o, i) => [o.id, i]));

  return [...ordenes].sort((a, b) => {
    const ordenA = a.orden_manual ?? null;
    const ordenB = b.orden_manual ?? null;

    if (ordenA !== null && ordenB !== null) {
      return ordenA - ordenB || (a.ot_number ?? 0) - (b.ot_number ?? 0);
    }
    // La ordenada a mano va antes que la que nadie tocó.
    if (ordenA !== null) return -1;
    if (ordenB !== null) return 1;

    return (posicion.get(a.id) ?? 0) - (posicion.get(b.id) ?? 0);
  });
}
