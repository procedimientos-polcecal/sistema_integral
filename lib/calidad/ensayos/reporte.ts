import { MALLAS_DEL_LISTADO } from "./granulometria";
import type { MuestraEvaluada } from "./limites";
import type { Muestra, ValorEvaluado } from "./types";

/**
 * El reporte del día: la planilla que calidad reparte.
 *
 * Una columna por muestra y una fila por determinación, que es la forma en la
 * que se viene leyendo.
 *
 * **Una columna por muestra, no un promedio.** El caso real son los despachos
 * —puede entrar uno al mediodía y otro a la tarde—; los demás productos se
 * ensayan una vez por día. Promediar dos muestras de 0,5% y 3% da 1,75% y
 * esconde que una se fue: la dispersión es justo el dato. Para distinguirlas se
 * usa la observación de cada muestra (*despacho mañana*, *despacho tarde*), que
 * es donde ya se escribe eso.
 *
 * **Y una tabla por juego de tamices.** Un Calcio tamiza desde #6 y un Filler
 * desde #50: meterlos en la misma tabla obliga a elegir entre perder las mallas
 * de uno o llenar de guiones las del otro. Cada juego distinto va en su propia
 * tabla, con sus propias filas, así que no se pierde ni una medición.
 */

export type TipoDeFila = "retenido" | "acumulado" | "peso_volumetrico" | "humedad";

export interface FilaDelReporte {
  etiqueta: string;
  tipo: TipoDeFila;
  malla?: number;
  /** Los acumulados van resaltados, como en la planilla de hoy. */
  destacada: boolean;
}

/** Las dos que cierran cualquier tabla, sea cual sea el juego de tamices. */
const FILAS_FINALES: FilaDelReporte[] = [
  { etiqueta: "Peso volumétrico (g/l)", tipo: "peso_volumetrico", destacada: false },
  { etiqueta: "Humedad bh (%)", tipo: "humedad", destacada: false },
];

/**
 * Las ocho filas del formato de siempre, en el orden de la planilla: cada
 * acumulado **pegado debajo de su retenido**, no los cuatro retenidos juntos y
 * después los acumulados. Es el orden en que se lee una granulometría.
 *
 * Las mallas son las cuatro de `MALLAS_DEL_LISTADO`, importadas y no copiadas:
 * si algún día el juego fino cambia, cambia en un solo lugar.
 */
export const FILAS_DEL_REPORTE: FilaDelReporte[] = [
  { etiqueta: `Ret #${MALLAS_DEL_LISTADO[0]} (%)`, tipo: "retenido", malla: MALLAS_DEL_LISTADO[0], destacada: false },
  { etiqueta: `Ret #${MALLAS_DEL_LISTADO[1]} (%)`, tipo: "retenido", malla: MALLAS_DEL_LISTADO[1], destacada: false },
  { etiqueta: `Ret #${MALLAS_DEL_LISTADO[2]} (%)`, tipo: "retenido", malla: MALLAS_DEL_LISTADO[2], destacada: false },
  { etiqueta: `Acumulado en #${MALLAS_DEL_LISTADO[2]} (%)`, tipo: "acumulado", malla: MALLAS_DEL_LISTADO[2], destacada: true },
  { etiqueta: `Ret #${MALLAS_DEL_LISTADO[3]} (%)`, tipo: "retenido", malla: MALLAS_DEL_LISTADO[3], destacada: false },
  { etiqueta: `Acumulado en #${MALLAS_DEL_LISTADO[3]} (%)`, tipo: "acumulado", malla: MALLAS_DEL_LISTADO[3], destacada: true },
  ...FILAS_FINALES,
];

/**
 * Las filas de una tabla para un juego de tamices que no es el de siempre.
 *
 * **Un retenido por malla y un solo acumulado, al final.** No es una invención:
 * es lo que calidad ya escribe cuando el juego es otro — los once bloques de la
 * hoja `Calcio` y la tabla de la hoja `Otros` del 02/10 anotan el retenido de
 * cada tamiz y cierran con un `Ac #200`. Un acumulado debajo de cada malla
 * duplicaría el alto de la tabla para repetir una suma corrida que nadie pide.
 */
export function filasParaMallas(mallas: number[]): FilaDelReporte[] {
  if (mallas.length === 0) return [...FILAS_FINALES];

  const ordenadas = [...mallas].sort((a, b) => a - b);
  const ultima = ordenadas[ordenadas.length - 1];

  return [
    ...ordenadas.map((m) => ({
      etiqueta: `Ret #${m} (%)`,
      tipo: "retenido" as const,
      malla: m,
      destacada: false,
    })),
    {
      etiqueta: `Acumulado en #${ultima} (%)`,
      tipo: "acumulado" as const,
      malla: ultima,
      destacada: true,
    },
    ...FILAS_FINALES,
  ];
}

export interface ColumnaDelReporte {
  muestra_id: string;
  producto: string;
  /** La observación, que es lo que distingue dos muestras del mismo día. */
  detalle: string | null;
  /** Alineada con las `filas` de su tabla. `null` es "no se midió". */
  celdas: (ValorEvaluado | null)[];
}

export interface TablaDelReporte {
  /**
   * Las mallas que tamizaron estas muestras. Vacío en la tabla del formato de
   * siempre, que tiene sus cuatro fijas aunque alguna no se haya medido.
   */
  mallas: number[];
  /** La del formato de siempre, que es la que se imprime igual que la planilla. */
  esElFormato: boolean;
  filas: FilaDelReporte[];
  columnas: ColumnaDelReporte[];
}

export interface Reporte {
  fecha: string;
  tablas: TablaDelReporte[];
}

export interface MuestraDelDia {
  muestra: Muestra;
  evaluada: MuestraEvaluada;
  producto: { id: string; nombre: string; orden: number };
}

function celdaDe(fila: FilaDelReporte, evaluada: MuestraEvaluada): ValorEvaluado | null {
  if (fila.tipo === "peso_volumetrico") {
    return evaluada.pesoVolumetrico.valor === null ? null : evaluada.pesoVolumetrico;
  }
  if (fila.tipo === "humedad") {
    return evaluada.humedad.valor === null ? null : evaluada.humedad;
  }

  const g = evaluada.granulometria.filas.find((f) => f.malla === fila.malla);
  if (!g) return null;

  const valor = fila.tipo === "retenido" ? g.retenido : g.acumulado;
  return valor.valor === null ? null : valor;
}

/** Las mallas que esa muestra tamizó, ordenadas. */
function mallasDe(d: MuestraDelDia): number[] {
  return d.evaluada.granulometria.filas.map((f) => f.malla).sort((a, b) => a - b);
}

/**
 * Si esa muestra entra en el formato de siempre.
 *
 * **Se decide por lo que la muestra midió y no por lo que el producto declara.**
 * Es a propósito y es la diferencia con `acumuladosDelListado`: el listado
 * muestra un producto por fila y le corresponde la forma del producto, pero el
 * reporte muestra mediciones, y una medición con tamices que la tabla no tiene
 * perdería números. Una muestra a la que le falte la #325 sigue entrando —su
 * juego cabe en el formato— y esa fila queda con el guión a la vista.
 */
function entraEnElFormato(mallas: number[]): boolean {
  return mallas.every((m) => (MALLAS_DEL_LISTADO as readonly number[]).includes(m));
}

function columnaDe(d: MuestraDelDia, filas: FilaDelReporte[]): ColumnaDelReporte {
  return {
    muestra_id: d.muestra.id,
    producto: d.producto.nombre,
    detalle: d.muestra.observaciones?.trim() || null,
    celdas: filas.map((f) => celdaDe(f, d.evaluada)),
  };
}

/**
 * El reporte de un día, repartido en tablas.
 *
 * La primera es la del formato de siempre, con todas las muestras cuyo juego de
 * tamices cabe adentro. Después, **una tabla por cada juego distinto**, en el
 * orden del catálogo de su primera muestra — así el reporte se lee en el mismo
 * orden que el listado.
 *
 * Dentro de cada tabla las columnas van por orden de catálogo y, dentro de un
 * producto, por el orden en que se cargaron: las dos muestras de un despacho
 * salen en el orden en que entraron los camiones.
 */
export function armarReporte(fecha: string, delDia: MuestraDelDia[]): Reporte {
  const ordenadas = [...delDia].sort(
    (a, b) =>
      a.producto.orden - b.producto.orden ||
      a.muestra.cargado_en.localeCompare(b.muestra.cargado_en)
  );

  const delFormato = ordenadas.filter((d) => entraEnElFormato(mallasDe(d)));

  // Las demás se agrupan por su juego de tamices exacto: dos Calcios del mismo
  // día comparten tabla, un Calcio y una dolomita tamizada distinto no.
  const porJuego = new Map<string, MuestraDelDia[]>();
  for (const d of ordenadas) {
    const mallas = mallasDe(d);
    if (entraEnElFormato(mallas)) continue;
    const clave = mallas.join("-");
    porJuego.set(clave, [...(porJuego.get(clave) ?? []), d]);
  }

  const tablas: TablaDelReporte[] = [];

  if (delFormato.length > 0) {
    tablas.push({
      mallas: [],
      esElFormato: true,
      filas: FILAS_DEL_REPORTE,
      columnas: delFormato.map((d) => columnaDe(d, FILAS_DEL_REPORTE)),
    });
  }

  for (const muestras of porJuego.values()) {
    const mallas = mallasDe(muestras[0]);
    const filas = filasParaMallas(mallas);
    tablas.push({
      mallas,
      esElFormato: false,
      filas,
      columnas: muestras.map((d) => columnaDe(d, filas)),
    });
  }

  return { fecha, tablas };
}

/**
 * Cómo se escribe una celda.
 *
 * El guión es el "no se midió" de la planilla de hoy, y es un dato: un cero ahí
 * se leería como que esa determinación dio cero. La humedad va con el signo de
 * porcentaje y dos decimales porque son valores de menos de 1 —`0,57%`—, y sin
 * decimales se verían todas iguales.
 */
export function comoSeEscribe(fila: FilaDelReporte, celda: ValorEvaluado | null): string {
  if (celda?.valor === null || celda === null) return "-";

  if (fila.tipo === "humedad") {
    return `${celda.valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }
  if (fila.tipo === "peso_volumetrico") {
    return celda.valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  }
  return celda.valor.toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/** La fecha como se lee en el encabezado: `06/10/2026`. */
export function fechaDelReporte(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** Cómo se titula una tabla que no es la del formato: `#6 a #200`. */
export function tituloDelJuego(mallas: number[]): string {
  if (mallas.length === 0) return "Sin granulometría";
  if (mallas.length === 1) return `#${mallas[0]}`;
  return `#${mallas[0]} a #${mallas[mallas.length - 1]}`;
}
