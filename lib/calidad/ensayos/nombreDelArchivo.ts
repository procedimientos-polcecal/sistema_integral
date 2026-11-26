import { hoyEnArgentina } from "@/lib/core/fechas";

/**
 * Cómo se llama lo que baja de la curva granulométrica: el Excel y cada una de
 * las tres imágenes.
 *
 * Vive acá y no dentro de la ruta del Excel porque desde el 25/11/2026 lo
 * necesitan los dos lados: la ruta arma el `Content-Disposition` y el navegador
 * arma el `download` del PNG, que nunca pasa por el servidor. Dos copias de
 * esta regla harían que el mismo conjunto de muestras saliera nombrado distinto
 * según qué botón se apretara.
 */

/** Lo que un nombre de archivo no puede llevar, porque se lee como una ruta. */
const PROHIBIDOS = /[\\/:*?"<>|]/g;

export function nombreDelArchivoDeLaCurva(
  muestras: { producto: string; fecha: string }[],
  opciones: {
    extension: "xlsx" | "png";
    /** Qué gráfico es, para las imágenes. El Excel lleva los tres y no lo manda. */
    grafico?: string;
    /** Para poder probar el día; en producción es ahora. */
    instante?: Date;
  }
): string {
  const partes = ["Curva granulométrica"];
  if (opciones.grafico) partes.push(opciones.grafico);

  if (muestras.length === 1) {
    partes.push(muestras[0].producto.replace(PROHIBIDOS, "-"), muestras[0].fecha);
  } else {
    // Con varias no hay un producto ni una fecha que valga por todas —se pueden
    // mezclar productos—, así que el archivo se fecha el día que se bajó.
    partes.push(`${muestras.length} muestras`, hoyEnArgentina(opciones.instante));
  }

  return `${partes.join(" - ")}.${opciones.extension}`;
}
