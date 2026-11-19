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
 * el caso de siempre —una muestra— se siga viendo igual.
 *
 * **El tono separa en pantalla; en papel separa el trazo, no el color.** Está
 * medido, y la primera versión de esta paleta lo afirmaba al revés: tenía el
 * verde `#1E7D34` y el naranja `#C2410C` con un contraste de luminancia de
 * **1,004**, o sea exactamente el mismo gris. Dos curvas indistinguibles en la
 * fotocopia del informe, que es adonde va el Excel.
 *
 * Y no se arregla eligiendo mejor los colores: **una línea tiene que verse
 * contra el fondo blanco**, lo que la deja por debajo de una luminancia de
 * 0,37, y seis valores dentro de esa banda no pasan de un contraste de ~1,2
 * entre sí. Por eso la paleta sólo garantiza que ningún par caiga en el mismo
 * gris —hoy el peor par es 1,21, contra aquel 1,004— y el que de verdad separa
 * es `TRAZOS_DE_LA_COMPARACION`, que no depende del tóner.
 *
 * Las dos propiedades están fijadas con tests en `comparacion.test.ts`.
 */
export const COLORES_DE_LA_COMPARACION = [
  "#1E7D34", // verde — el de la curva única
  "#111827", // grafito
  "#EA580C", // naranja
  "#1D4ED8", // azul
  "#CA8A04", // ocre
  "#881337", // vino
];

/**
 * El trazo de cada curva, alineado con `COLORES_DE_LA_COMPARACION`.
 *
 * Es el `strokeDasharray` de SVG. **El primero es `undefined` —línea llena— a
 * propósito**: con una sola muestra la pantalla tiene que verse igual que antes
 * de que la comparación existiera.
 *
 * Éste es el mecanismo que separa las curvas en blanco y negro; el color es
 * para la pantalla. El porqué medido está arriba.
 */
export const TRAZOS_DE_LA_COMPARACION: (string | undefined)[] = [
  undefined,
  "6 3",
  "2 3",
  "10 4 2 4",
  "1 3",
  "8 3 2 3 2 3",
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
  /** `strokeDasharray` de su línea; `undefined` es llena. Ver `TRAZOS_DE_LA_COMPARACION`. */
  trazo?: string;
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
  /**
   * Las elegidas que no tienen **ninguna** malla cargada, por su etiqueta.
   *
   * Van aparte de `disparejas` porque decir «no midió #6, #7, #10, #12, #20,
   * #50, #100 ni #200» es cierto y una forma rarísima de decir «esta muestra no
   * tiene granulometría». El listado del producto trae todas sus muestras,
   * incluidas las cargadas sólo con humedad o peso volumétrico, así que elegir
   * una es un camino normal y no un caso raro.
   *
   * **No es lo mismo que una muestra sin peso tamizado**: ésa sí midió, y
   * `granulometria()` ya tiene un texto para ella que viaja en `problema`.
   */
  sinGranulometria: string[];
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

/**
 * Si la etiqueta tiene que llevar el producto adelante.
 *
 * Está acá, y no escrito dos veces, porque lo preguntan la pantalla y el Excel:
 * si los dos dejaran de coincidir, la misma muestra saldría nombrada distinto
 * en cada lado y nada lo notaría.
 */
export function hayVariosProductos(muestras: { producto: string }[]): boolean {
  return new Set(muestras.map((m) => m.producto)).size > 1;
}

export function compararMuestras(
  muestras: MuestraParaComparar[],
  apagadas: number[]
): Comparacion {
  const conProducto = hayVariosProductos(muestras);
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
    ...(TRAZOS_DE_LA_COMPARACION[i % TRAZOS_DE_LA_COMPARACION.length] === undefined
      ? {}
      : { trazo: TRAZOS_DE_LA_COMPARACION[i % TRAZOS_DE_LA_COMPARACION.length] }),
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

  // Sin mallas **y** sin problema. Una muestra a la que le falta el peso
  // tamizado también llega con cero mallas, pero ésa sí midió y
  // `granulometria()` ya tiene su texto: meterla acá diría que no cargó nada.
  const sinGranulometria = series
    .filter((serie, i) => calculadas[i].medidas.size === 0 && serie.problema === undefined)
    .map((serie) => serie.etiqueta);

  // Se compara contra el eje dibujado y no contra la unión entera: una malla
  // que nadie ve porque está apagada no es un hueco que haya que explicar. Y
  // las que no midieron nada quedan afuera: tienen su propia lista.
  const disparejas = series
    .map((serie, i) => ({
      etiqueta: serie.etiqueta,
      faltan:
        calculadas[i].medidas.size === 0
          ? []
          : delEje.filter((malla) => !calculadas[i].medidas.has(malla)),
    }))
    .filter((d) => d.faltan.length > 0);

  return { mallas, filas, series, disparejas, sinGranulometria };
}
