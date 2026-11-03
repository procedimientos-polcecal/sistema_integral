/**
 * Ordenar la tabla de condiciones tocando el encabezado de una columna.
 *
 * Es el mismo gesto que la tabla de MTBF (`lib/mantenimiento/mtbfOrden.ts`), y
 * por los mismos motivos vive acá y no en la pantalla: qué fila queda arriba es
 * una decisión, no una presentación.
 *
 * TRES COSAS QUE NO SE DEDUCEN DE MIRAR LA TABLA:
 *
 * - **El orden por defecto no es ninguna columna, y volver a él tiene que ser
 *   posible.** `ordenarParaGestion` sube lo vencido y lo incompleto, que es el
 *   anti-objetivo declarado del módulo: la planilla que esto reemplaza tenía 35
 *   de 44 condiciones sin evaluar porque nada las mostraba. Ordenar por una
 *   columna **pisa esa garantía mientras dure**, y por eso es siempre un acto
 *   explícito de quien mira y nunca el estado inicial. `SIN_COLUMNA` es el
 *   camino de vuelta.
 * - **Los nulos van al final en los dos sentidos**, y acá eso pesa más que en
 *   MTBF: hoy 37 de 44 condiciones no tienen lugar, 44 no tienen peligro y 35
 *   no tienen nivel. Si viajaran con los valores, invertir la flecha llenaría
 *   la primera pantalla de celdas vacías. Una condición sin evaluar no es «la
 *   de menor riesgo»: es una de la que no se sabe, y eso ya lo dice su insignia
 *   ámbar.
 * - **El estado no se ordena alfabéticamente.** Alfabético pone «Cerrada»
 *   primero, que es exactamente lo contrario de para qué se mira esta tabla.
 *   Va por urgencia: vencida, pendiente, cerrada.
 *
 * Y una que sí se deduce pero conviene dejar escrita: **el desempate es siempre
 * por número descendente** y no se invierte con la flecha, así que dos filas
 * con el mismo valor salen en un orden estable y la más nueva arriba.
 */
import type { FilaDeCondicion } from "./gestion";
import { estadoDe } from "./condicion";

/** `""` es el orden por defecto de la pantalla, el que sube lo que falta. */
export const SIN_COLUMNA = "" as const;

export type ColumnaOrdenable =
  | "numero"
  | "estado"
  | "lugar"
  | "descripcion"
  | "peligro"
  | "riesgo"
  | "responsable"
  | "fecha_maxima";

export interface OrdenDeColumna {
  columna: ColumnaOrdenable | typeof SIN_COLUMNA;
  ascendente: boolean;
}

/** El orden con el que abre la pantalla: el de siempre, sin columna elegida. */
export const ORDEN_POR_DEFECTO: OrdenDeColumna = { columna: SIN_COLUMNA, ascendente: true };

export const COLUMNAS_ORDENABLES: readonly ColumnaOrdenable[] = [
  "numero", "estado", "lugar", "descripcion", "peligro", "riesgo", "responsable", "fecha_maxima",
];

/**
 * Por urgencia y no por abecedario. El número es sólo para ordenar: no se
 * muestra en ningún lado.
 */
const URGENCIA_DEL_ESTADO = { Vencida: 0, Pendiente: 1, Cerrada: 2 } as const;

/** El lugar como se lee en la tabla: el sector, o el equipo, o nada. */
function lugarDe(c: FilaDeCondicion): string | null {
  return c.sectores?.nombre ?? c.equipos?.name ?? null;
}

/**
 * Lo que se compara en cada columna. `null` sale al final, sea cual sea el
 * sentido de la flecha.
 *
 * `hoy` hace falta para el estado, que es derivado y no una columna de la base.
 * `nombreDeUsuario` hace falta porque la fila trae `responsable_id` y lo que se
 * ve —y por lo tanto lo que se ordena— es el nombre.
 */
export function valorDe(
  c: FilaDeCondicion,
  columna: ColumnaOrdenable,
  hoy: string,
  nombreDeUsuario: Map<string, string>,
): string | number | null {
  switch (columna) {
    case "numero": return c.numero;
    case "estado": return URGENCIA_DEL_ESTADO[estadoDe(c, hoy)];
    case "lugar": return lugarDe(c);
    case "descripcion": return c.descripcion;
    case "peligro": return c.syh_peligros?.nombre ?? null;
    case "riesgo": return c.nivel_riesgo;
    case "responsable": return c.responsable_id ? (nombreDeUsuario.get(c.responsable_id) ?? null) : null;
    case "fecha_maxima": return c.fecha_maxima;
  }
}

/** No modifica la lista que recibe. Con `SIN_COLUMNA` devuelve una copia tal cual. */
export function ordenarPorColumna(
  filas: FilaDeCondicion[],
  { columna, ascendente }: OrdenDeColumna,
  hoy: string,
  nombreDeUsuario: Map<string, string>,
): FilaDeCondicion[] {
  if (columna === SIN_COLUMNA) return [...filas];

  return [...filas].sort((a, b) => {
    const x = valorDe(a, columna, hoy, nombreDeUsuario);
    const y = valorDe(b, columna, hoy, nombreDeUsuario);

    if (x === null && y === null) return b.numero - a.numero;
    if (x === null) return 1;
    if (y === null) return -1;

    const c = typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), "es");
    if (c !== 0) return ascendente ? c : -c;

    return b.numero - a.numero;
  });
}

/**
 * Qué orden queda al tocar un encabezado.
 *
 * La misma columna da vuelta la flecha; una columna nueva arranca mostrando
 * **lo que se quiere ver primero de ella**, que no siempre es ascendente: del
 * número, la condición más nueva; del riesgo, el más alto; de la fecha máxima,
 * la que vence antes; del estado, lo más urgente; y de las de texto, la A.
 */
export function siguienteOrden(actual: OrdenDeColumna, columna: ColumnaOrdenable): OrdenDeColumna {
  if (actual.columna === columna) return { columna, ascendente: !actual.ascendente };
  const arrancaDescendente = columna === "numero" || columna === "riesgo";
  return { columna, ascendente: !arrancaDescendente };
}
