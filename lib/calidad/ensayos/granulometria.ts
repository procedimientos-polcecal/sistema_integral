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
