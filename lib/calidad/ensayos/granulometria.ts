import type { ValorEvaluado } from "./types";

/**
 * Los retenidos de una muestra, en porcentaje, y el acumulado de cada malla.
 *
 * **El acumulado no se guarda ni se tipea: se despeja.** En el Excel era una
 * columna que alguien escribía, y no cerraba contra sus propias partes en 32
 * filas — 27 porque la columna de al lado estaba en otra escala, y cinco por
 * tipeo suelto, como la fila 178 de `Filler 1`: `0 + 3,4 + 19,5 = 22,9` y la
 * celda dice `21,9`. Acá no puede no cerrar, porque no existe como dato.
 *
 * El orden es por número de malla creciente, que es abertura decreciente: el
 * acumulado a #200 es todo lo que no pasó por #200, o sea la suma de #50, #100
 * y #200. Comprobado contra la fila 150 de `Filler 1`, que cierra exacta.
 */

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface FilaDeGranulometria {
  malla: number;
  retenido: ValorEvaluado;
  acumulado: ValorEvaluado;
}

export interface Granulometria {
  filas: FilaDeGranulometria[];
  problema?: string;
}

export function granulometria(ensayo: {
  pesoMuestraG: number | null;
  retenidos: { malla: number; retenido_g: number }[];
}): Granulometria {
  const { pesoMuestraG, retenidos } = ensayo;
  if (retenidos.length === 0) return { filas: [] };

  if (typeof pesoMuestraG !== "number" || !Number.isFinite(pesoMuestraG) || pesoMuestraG <= 0) {
    return { filas: [], problema: "Falta el peso de la muestra tamizada." };
  }

  const ordenados = [...retenidos].sort((a, b) => a.malla - b.malla);

  let corrido = 0;
  const filas = ordenados.map((r) => {
    corrido += r.retenido_g;
    return {
      malla: r.malla,
      retenido: { valor: redondear((r.retenido_g / pesoMuestraG) * 100) },
      acumulado: { valor: redondear((corrido / pesoMuestraG) * 100) },
    };
  });

  // No se recorta a 100: lo retenido no puede superar a la muestra, y verlo es
  // la única forma de corregirlo.
  return corrido > pesoMuestraG
    ? { filas, problema: "Lo retenido supera el peso de la muestra." }
    : { filas };
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Las cuatro mallas que el listado muestra en columna.
 *
 * Son las del juego fino —Filler 1, Filler 2, Cal y los dos despachos—, que es
 * donde el reparto entre mallas dice algo: cuánto quedó en cada tamiz, no sólo
 * cuánto quedó en total.
 */
export const MALLAS_DEL_LISTADO = [50, 100, 200, 325] as const;

/**
 * La malla que distingue a un producto fino de uno que no lo es.
 *
 * Los cinco que se tamizan hasta #325 muestran las cuatro columnas. Los Calcios
 * llegan hasta #200 y ahí el reparto fino no es la pregunta: su juego arranca en
 * #6 y lo que interesa es cuánto quedó retenido en total, un número solo.
 *
 * **Se decide por las mallas declaradas del producto y no por lo que se midió**
 * en esa muestra: una muestra a la que le falte cargar la #325 es una muestra
 * incompleta de un producto fino, no un producto distinto, y tiene que seguir
 * mostrando sus cuatro columnas con el hueco a la vista.
 */
const MALLA_DEL_FINO = 325;

/** La única que se muestra cuando el producto no es fino. */
const MALLA_DEL_GRUESO = 200;

/**
 * El acumulado de cada columna del listado, alineado con `MALLAS_DEL_LISTADO`.
 *
 * Devuelve siempre cuatro lugares; `null` es "esta columna no va para este
 * producto" o "esa malla no se midió". Las dos se dibujan igual —en blanco—
 * porque las dos significan que ahí no hay número, y el detalle de la muestra
 * es el lugar donde se ve cuál de las dos es.
 *
 * **Nunca cae a la malla de al lado.** Si a un Calcio le falta la #200, la
 * columna queda vacía en vez de mostrar la #100: un número en la columna que no
 * es, es el error que no se nota.
 */
export function acumuladosDelListado(
  mallasDelProducto: number[],
  filas: FilaDeGranulometria[]
): (ValorEvaluado | null)[] {
  const esFino = mallasDelProducto.includes(MALLA_DEL_FINO);
  const queSeMuestran = esFino ? MALLAS_DEL_LISTADO : [MALLA_DEL_GRUESO];

  const porMalla = new Map(filas.map((f) => [f.malla, f.acumulado]));

  return MALLAS_DEL_LISTADO.map((malla) =>
    queSeMuestran.includes(malla) ? (porMalla.get(malla) ?? null) : null
  );
}
