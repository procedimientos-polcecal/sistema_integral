import type { ValorEvaluado } from "./types";

/**
 * Las tres determinaciones que salen de una cuenta de una línea.
 *
 * **Todas devuelven el número como se lee**: por ciento de 0 a 100 para la
 * humedad y la cal útil vial, g/l para el peso volumétrico. Es la misma unidad
 * en que se guardan los límites, y por eso se pueden comparar sin convertir
 * nada — que es exactamente el paso donde el Excel se rompió: la columna
 * "Ret #100 (%)" quedó guardada como fracción en una época y como número pelado
 * en otra, y la única señal de cuál era cuál era el formato de la celda.
 */

/** Dos decimales. Más que eso es precisión que la balanza no tiene. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function esNumero(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * `(P inicial − P final) / (P inicial − P recipiente)`, en por ciento.
 *
 * Los tres pesos van siempre: en el Excel la mitad de las hojas guardaba sólo
 * el resultado, y entonces no había cómo auditar un número raro sin volver al
 * cuaderno del laboratorio.
 */
export function humedad(pesos: {
  recipiente: number | null;
  inicial: number | null;
  final: number | null;
}): ValorEvaluado {
  const { recipiente, inicial, final } = pesos;
  if (!esNumero(recipiente) || !esNumero(inicial) || !esNumero(final)) {
    return { valor: null };
  }

  const seco = inicial - recipiente;
  if (seco <= 0) {
    // El `#DIV/0!` real de `Despacho a Kartonsec` fila 27. En el Excel quedó el
    // error escrito en la celda; acá se dice qué pasó.
    return {
      valor: null,
      problema: "El peso inicial no supera al del recipiente: la muestra pesa cero.",
    };
  }

  const valor = redondear(((inicial - final) / seco) * 100);

  // No se recorta: una humedad negativa es un error de carga o de balanza, y es
  // justo lo que hay que ver.
  return final > inicial
    ? { valor, problema: "El peso final es mayor que el inicial: la muestra ganó peso." }
    : { valor };
}

/**
 * Los gramos llevados a un litro.
 *
 * **El volumen es un dato de la muestra y no una constante.** En el archivo
 * conviven dos recipientes —once fórmulas multiplican por 3, que supone 333,3
 * cc, y dos hacen `×1000/330`—, un 1% de diferencia sistemática entre hojas. El
 * real es 330, pero guardarlo deja dicho con cuál se midió cada muestra.
 */
export function pesoVolumetrico(medicion: {
  gramos: number | null;
  volumenCc: number | null;
}): ValorEvaluado {
  const { gramos, volumenCc } = medicion;
  if (!esNumero(gramos)) return { valor: null };
  if (!esNumero(volumenCc) || volumenCc <= 0) {
    return { valor: null, problema: "Falta el volumen del recipiente." };
  }
  return { valor: redondear((gramos * 1000) / volumenCc) };
}

/** Gramos de cal útil por mililitro de ácido. Es la constante del método. */
const CAL_UTIL_POR_ML = 0.037;

/**
 * `ml × 0,037 / peso de muestra`, en por ciento.
 *
 * El peso va cargado y propuesto en 3 g, que es sobre lo que se tituló en las
 * tres filas que existen. Dejarlo fijo en el código haría que el día que se
 * titule sobre 5 g el número salga mal en silencio.
 */
export function calUtilVial(titulacion: {
  mlAcido: number | null;
  pesoMuestraG: number | null;
}): ValorEvaluado {
  const { mlAcido, pesoMuestraG } = titulacion;
  if (!esNumero(mlAcido)) return { valor: null };
  if (!esNumero(pesoMuestraG) || pesoMuestraG <= 0) {
    return { valor: null, problema: "Falta el peso de la muestra titulada." };
  }
  return { valor: redondear(((mlAcido * CAL_UTIL_POR_ML) / pesoMuestraG) * 100) };
}
