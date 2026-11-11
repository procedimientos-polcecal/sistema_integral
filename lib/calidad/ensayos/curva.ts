import { granulometria } from "./granulometria";

/**
 * La curva granulométrica de una muestra, con los tamices que se apagan.
 *
 * **Apagar un tamiz filtra filas; nunca recalcula un acumulado.** El acumulado
 * de la malla siguiente ya incluye lo que retuvo la apagada, así que unir #12
 * con #50 dice «entre esas dos mallas el acumulado pasó de 0,9 a 41,6», que es
 * lo que se habría medido sin tamizar en #20. Recalcular sin la #20 daría 35,6,
 * un número que nadie midió.
 */

export interface PuntoDeLaCurva {
  malla: number;
  retenido: number;
  acumulado: number;
}

export interface Curva {
  /** Las mallas que midió la muestra, en orden. Son los chips de la pantalla. */
  mallas: number[];
  /** Sólo las prendidas, en orden. Es lo que se dibuja. */
  puntos: PuntoDeLaCurva[];
  problema?: string;
}

export function curvaDeLaMuestra(
  ensayo: { pesoMuestraG: number | null; retenidos: { malla: number; retenido_g: number }[] },
  apagadas: number[]
): Curva {
  const { filas, problema } = granulometria(ensayo);

  const puntos: PuntoDeLaCurva[] = [];
  for (const fila of filas) {
    if (apagadas.includes(fila.malla)) continue;

    const { valor: retenido } = fila.retenido;
    const { valor: acumulado } = fila.acumulado;
    // Defensivo y no un caso real: `granulometria()` sólo arma filas cuando el
    // peso es válido, y ahí siempre escribe un número. Si algún día llegara un
    // null, se descarta la fila: convertirlo en cero inventaría una medición.
    if (retenido === null || acumulado === null) continue;

    puntos.push({ malla: fila.malla, retenido, acumulado });
  }

  return {
    mallas: filas.map((f) => f.malla),
    puntos,
    ...(problema === undefined ? {} : { problema }),
  };
}
