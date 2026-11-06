/**
 * Por qué una orden de trabajo todavía no se hizo.
 *
 * La observación que ya existía se completa **al realizar** el trabajo: qué se
 * encontró, qué se cambió. Vive en la ejecución y en la columna W. Para una OT
 * que sigue abierta no sirve, porque no hay ejecución de la que colgarla — y
 * ésa es justamente la que hay que explicar.
 *
 * Es un historial y no un campo: una OT atrasada se vuelve a justificar con el
 * tiempo ("falta el repuesto" → "esperamos la parada de planta"), y pisar la
 * razón anterior borra la única señal de que se viene postergando. Por eso las
 * notas no se editan. A la planilla, que tiene una celda y no una lista, va
 * **la última**: lo que le sirve a quien la mira es por qué está parada hoy.
 */

import { textoParaLaCelda } from "@/lib/core/sheets";
import { COLUMNA_OBSERVACION_PREVIA } from "@/lib/mantenimiento/ordenes";

/**
 * Lo más largo que puede ser una justificación.
 *
 * Es un tope de lectura, no de base: lo que se escribe acá termina en una celda
 * de planilla y se lee de un vistazo en una fila. Mil caracteres son unas
 * quince líneas; lo que no entre ahí es un informe y va en otro lado.
 */
export const MAXIMO_DE_NOTA = 1000;

/** Una justificación, como vuelve de la base. */
export interface Nota {
  id: string;
  texto: string;
  creado_en: string;
  creado_por: string | null;
}

export type NotaValidada =
  | { ok: true; texto: string }
  | { ok: false; error: string };

/**
 * El texto de una nota, validado.
 *
 * Se rechaza en vez de recortar: una justificación cortada a la mitad dice algo
 * distinto de lo que se escribió, y el que la escribió no se entera.
 */
export function validarNota(valor: unknown): NotaValidada {
  if (typeof valor !== "string") {
    return { ok: false, error: "Falta decir por qué no se hizo." };
  }

  const texto = valor.trim();
  if (!texto) return { ok: false, error: "Falta decir por qué no se hizo." };

  if (texto.length > MAXIMO_DE_NOTA) {
    return {
      ok: false,
      error:
        `La justificación no puede pasar de ${MAXIMO_DE_NOTA} caracteres ` +
        `(tiene ${texto.length}).`,
    };
  }

  return { ok: true, texto };
}

/**
 * La más nueva de las notas, que es la que va a la planilla y la que se muestra
 * arriba.
 *
 * No confía en el orden en que vinieron: la base las puede traer de cualquier
 * forma y el empate —dos notas en el mismo instante, que pasa cuando alguien
 * aprieta dos veces— lo gana la última del lote, que es la que se insertó
 * después. Una fecha ilegible no le gana a ninguna buena.
 */
export function laUltimaNota<T extends { creado_en: string }>(
  notas: readonly T[]
): T | null {
  let elegida: T | null = null;
  let cuando = -Infinity;

  for (const nota of notas) {
    const t = new Date(nota.creado_en).getTime();
    if (isNaN(t)) {
      // Sin fecha utilizable sólo sirve si no hay ninguna otra.
      if (elegida === null) elegida = nota;
      continue;
    }
    if (t >= cuando) {
      cuando = t;
      elegida = nota;
    }
  }

  return elegida;
}

/**
 * Si a esta orden hay que pedirle una justificación.
 *
 * Todas las que no están realizadas: una por hacer, una atrasada, una suspendida
 * y hasta una en proceso siguen sin estar hechas, y la pregunta es la misma.
 *
 * Un estado que no conocemos pide igual. Esconder el bloque dejaría una OT sin
 * justificar **y sin forma de justificarla**, que es exactamente el caso que
 * nadie ve.
 */
export function pideJustificacion(estado: unknown): boolean {
  return String(estado ?? "").trim().toUpperCase() !== "REALIZADO";
}

/**
 * La celda de la planilla con la última justificación.
 *
 * `null` la vacía, que es lo que tiene que pasar si se borró la única nota:
 * dejar la anterior sería mentir sobre por qué está parada.
 */
export function celdaDeObservacionPrevia(
  texto: string | null
): { columna: number; valor: string } {
  return {
    columna: COLUMNA_OBSERVACION_PREVIA,
    valor: textoParaLaCelda(texto),
  };
}
