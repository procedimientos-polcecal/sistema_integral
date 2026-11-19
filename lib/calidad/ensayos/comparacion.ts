import { comoSeLee } from "@/lib/core/fechas";
import { curvaDeLaMuestra } from "./curva";

/**
 * Varias muestras sobre el mismo par de ejes, para compararlas.
 *
 * **El eje X es la unión de las mallas medidas, y lo que falta queda en `null`.**
 * Las muestras del mismo producto no siempre miden los mismos tamices: medido
 * contra la base el 19/11/2026, pasa en 4 de los 8 productos con granulometría
 * —Filler 1 tiene tres juegos distintos entre sus 21 muestras—, así que cruzar
 * una que midió `#20` con otra que midió `#325` es el caso normal y no el raro.
 *
 * Las tres salidas que no se tomaron, y por qué:
 *
 * - **Interpolar** dibuja un punto en una malla que esa muestra no tamizó, con
 *   el mismo aspecto que los medidos. Es la regla de todo el sistema: enlazar
 *   al que se le parece es peor que dejar en null.
 * - **Poner cero** afirma «no quedó nada retenido ahí», que es una medición, y
 *   falsa; en el acumulado además haría bajar la curva, que es imposible.
 * - **Cortar el eje a la intersección** esconde mediciones reales: con un
 *   Filler 1 de cada juego, la intersección es `#50,100,200` y se perderían
 *   `#20` y `#325`, que son justo los extremos donde se ve si el material se
 *   fue a grueso o a fino.
 *
 * El hueco se dibuja como hueco —`connectNulls={false}` del lado de recharts— y
 * se nombra: `disparejas` dice qué muestra no midió qué, porque una línea que
 * se corta sin explicación se lee como un error del sistema.
 *
 * **Apagar un tamiz sigue sin recalcular nada**, igual que con una muestra
 * sola: saca el punto de todas las curvas y los acumulados que siguen
 * conservan lo que ésa retuvo.
 */

/**
 * Cuántas muestras se pueden comparar a la vez.
 *
 * Seis, por dos razones medidas: el producto más cargado tiene 23 muestras y
 * superponerlas es ruido, y seis es lo que una paleta distingue de verdad
 * impresa en gris, que es donde termina el Excel.
 */
export const TOPE_DE_MUESTRAS = 6;

/**
 * Un color por muestra, el mismo en los tres gráficos.
 *
 * El primero es el verde que ya usaba la pantalla con una sola curva, para que
 * el caso de siempre —una muestra— se siga viendo igual. Los otros cinco se
 * eligieron para separarse también en gris: alternan claro y oscuro en vez de
 * confiar sólo en el tono.
 */
export const COLORES_DE_LA_COMPARACION = [
  "#1E7D34", // verde
  "#1D4ED8", // azul
  "#C2410C", // naranja quemado
  "#7E22CE", // violeta
  "#0E7490", // petróleo
  "#A16207", // ocre
];

export interface MuestraParaComparar {
  id: string;
  producto: string;
  /** ISO, como viene de la base. */
  fecha: string;
  observaciones: string | null;
  pesoMuestraG: number | null;
  retenidos: { malla: number; retenido_g: number }[];
}

export interface SerieDeLaComparacion {
  id: string;
  etiqueta: string;
  color: string;
  /** Dónde buscar sus tres valores en cada fila: `r0`, `a0`, `p0` para la serie 0. */
  claves: { retenido: string; acumulado: string; pasante: string };
  problema?: string;
}

/**
 * Una malla del eje dibujado. Lleva `malla` y, por cada serie, sus tres claves
 * con el valor o `null` si esa muestra no midió esa malla.
 *
 * Las claves son cortas y sin puntos a propósito: recharts resuelve un
 * `dataKey` con notación de camino, así que un `retenido.a` se leería como dos
 * niveles.
 */
export type FilaDeLaComparacion = Record<string, number | null>;

export interface Comparacion {
  /** Unión de las mallas que midió alguna, ascendente. Son los chips. */
  mallas: number[];
  /** La unión menos las apagadas: lo que se dibuja. */
  filas: FilaDeLaComparacion[];
  series: SerieDeLaComparacion[];
  /** Quién no midió qué, sobre el eje dibujado. Vacío si todas midieron lo mismo. */
  disparejas: { etiqueta: string; faltan: number[] }[];
}

/** Hasta dónde se lee una observación en la etiqueta antes de cortarla. */
const LARGO_DE_LA_OBSERVACION = 40;

/**
 * Cómo se lee cada muestra: con el producto adelante sólo cuando hace falta.
 *
 * Es el `etiquetasDe` que vivía dentro de la pantalla, mudado acá para que lo
 * compartan la pantalla y el Excel, y para poder probarlo.
 *
 * Dos muestras del mismo día son un caso real y **la observación no alcanza
 * para distinguirlas**: medido contra la base, de 91 muestras sólo 13 tenían
 * observaciones, y en 2 de los 6 grupos de (producto, fecha) con más de una el
 * texto salía idéntico. Por eso los empates se numeran —«(1 de 2)», «(2 de
 * 2)»—, en el orden en que llegan, que la consulta ya hace determinista. No se
 * muestra la hora de carga: es cuándo se tipeó la muestra y no cuándo se midió,
 * y ponerla invita a leerla como lo segundo.
 */
export function etiquetasDeMuestras(
  muestras: { producto: string; fecha: string; observaciones: string | null }[],
  conProducto: boolean
): string[] {
  const base = muestras.map((m) => {
    const partes = conProducto ? [m.producto, comoSeLee(m.fecha)] : [comoSeLee(m.fecha)];
    const obs = m.observaciones?.trim();
    if (obs) {
      partes.push(
        obs.length > LARGO_DE_LA_OBSERVACION ? `${obs.slice(0, LARGO_DE_LA_OBSERVACION)}…` : obs
      );
    }
    return partes.join(" · ");
  });

  const total = new Map<string, number>();
  for (const e of base) total.set(e, (total.get(e) ?? 0) + 1);

  const visto = new Map<string, number>();
  return base.map((e) => {
    const n = total.get(e) ?? 1;
    if (n === 1) return e;
    const orden = (visto.get(e) ?? 0) + 1;
    visto.set(e, orden);
    return `${e} (${orden} de ${n})`;
  });
}

export function compararMuestras(
  muestras: MuestraParaComparar[],
  apagadas: number[]
): Comparacion {
  const conProducto = new Set(muestras.map((m) => m.producto)).size > 1;
  const etiquetas = etiquetasDeMuestras(muestras, conProducto);

  // Una pasada por muestra: las mallas que midió —sin apagar nada, que son las
  // que van a los chips— y los puntos que sí se dibujan.
  const calculadas = muestras.map((m) => {
    const todas = curvaDeLaMuestra(m, []);
    const dibujada = curvaDeLaMuestra(m, apagadas);
    return {
      medidas: new Set(todas.mallas),
      puntos: new Map(dibujada.puntos.map((p) => [p.malla, p])),
      problema: todas.problema,
    };
  });

  const union = new Set<number>();
  for (const c of calculadas) for (const malla of c.medidas) union.add(malla);
  const mallas = [...union].sort((a, b) => a - b);

  const delEje = mallas.filter((m) => !apagadas.includes(m));

  const series: SerieDeLaComparacion[] = muestras.map((m, i) => ({
    id: m.id,
    etiqueta: etiquetas[i],
    color: COLORES_DE_LA_COMPARACION[i % COLORES_DE_LA_COMPARACION.length],
    claves: { retenido: `r${i}`, acumulado: `a${i}`, pasante: `p${i}` },
    ...(calculadas[i].problema === undefined ? {} : { problema: calculadas[i].problema }),
  }));

  const filas: FilaDeLaComparacion[] = delEje.map((malla) => {
    const fila: FilaDeLaComparacion = { malla };
    series.forEach((serie, i) => {
      const punto = calculadas[i].puntos.get(malla);
      fila[serie.claves.retenido] = punto?.retenido ?? null;
      fila[serie.claves.acumulado] = punto?.acumulado ?? null;
      fila[serie.claves.pasante] = punto?.pasante ?? null;
    });
    return fila;
  });

  // Se compara contra el eje dibujado y no contra la unión entera: una malla
  // que nadie ve porque está apagada no es un hueco que haya que explicar.
  const disparejas = series
    .map((serie, i) => ({
      etiqueta: serie.etiqueta,
      faltan: delEje.filter((malla) => !calculadas[i].medidas.has(malla)),
    }))
    .filter((d) => d.faltan.length > 0);

  return { mallas, filas, series, disparejas };
}
