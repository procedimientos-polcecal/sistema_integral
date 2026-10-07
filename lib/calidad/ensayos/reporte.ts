import { MALLAS_DEL_LISTADO } from "./granulometria";
import type { MuestraEvaluada } from "./limites";
import type { Muestra, ValorEvaluado } from "./types";

/**
 * El reporte del día: la planilla que calidad reparte.
 *
 * Una columna por muestra y una fila por determinación, que es la forma en la
 * que se viene leyendo. Las ocho filas son fijas y las columnas las pone el día.
 *
 * **Una columna por muestra, no un promedio.** El caso real son los despachos
 * —puede entrar uno al mediodía y otro a la tarde—; los demás productos se
 * ensayan una vez por día. Promediar dos muestras de 0,5% y 3% da 1,75% y
 * esconde que una se fue: la dispersión es justo el dato. Para distinguirlas se
 * usa la observación de cada muestra (*despacho mañana*, *despacho tarde*), que
 * es donde ya se escribe eso.
 */

export type TipoDeFila = "retenido" | "acumulado" | "peso_volumetrico" | "humedad";

export interface FilaDelReporte {
  etiqueta: string;
  tipo: TipoDeFila;
  malla?: number;
  /** Los acumulados van resaltados, como en la planilla de hoy. */
  destacada: boolean;
}

/**
 * Las ocho filas, en el orden de la planilla: cada acumulado **pegado debajo de
 * su retenido**, no los cuatro retenidos juntos y después los acumulados. Es el
 * orden en que se lee una granulometría.
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
  { etiqueta: "Peso volumétrico (g/l)", tipo: "peso_volumetrico", destacada: false },
  { etiqueta: "Humedad bh (%)", tipo: "humedad", destacada: false },
];

export interface ColumnaDelReporte {
  muestra_id: string;
  producto: string;
  /** La observación, que es lo que distingue dos muestras del mismo día. */
  detalle: string | null;
  /** Alineada con `FILAS_DEL_REPORTE`. `null` es "no se midió". */
  celdas: (ValorEvaluado | null)[];
  /**
   * Las mallas que esta muestra tamizó y que el formato no muestra — los #6 a
   * #20 de un Calcio. Se avisa al pie en vez de perderlas en silencio.
   */
  mallasQueNoEntran: number[];
}

export interface Reporte {
  fecha: string;
  columnas: ColumnaDelReporte[];
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

/**
 * El reporte de un día.
 *
 * Las columnas van por el orden del catálogo y, dentro de un producto, por el
 * orden en que se cargaron: las dos muestras de un despacho salen en el orden
 * en que entraron los camiones, que es como se leen.
 */
export function armarReporte(fecha: string, delDia: MuestraDelDia[]): Reporte {
  const ordenadas = [...delDia].sort(
    (a, b) =>
      a.producto.orden - b.producto.orden ||
      a.muestra.cargado_en.localeCompare(b.muestra.cargado_en)
  );

  const columnas = ordenadas.map((d) => {
    const mallasMostradas = FILAS_DEL_REPORTE.filter((f) => f.malla !== undefined).map((f) => f.malla!);

    return {
      muestra_id: d.muestra.id,
      producto: d.producto.nombre,
      detalle: d.muestra.observaciones?.trim() || null,
      celdas: FILAS_DEL_REPORTE.map((f) => celdaDe(f, d.evaluada)),
      mallasQueNoEntran: d.evaluada.granulometria.filas
        .map((g) => g.malla)
        .filter((m) => !mallasMostradas.includes(m))
        .sort((a, b) => a - b),
    };
  });

  return { fecha, columnas };
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
