import { comoSeLee } from "@/lib/core/fechas";
import { curvaDeLaMuestra } from "./curva";
import { etiquetasDeMuestras, type MuestraParaComparar } from "./comparacion";

/**
 * Las filas del Excel de la curva granulométrica, tal cual van al `.xlsx`.
 *
 * **Formato largo: una fila por cada par (muestra, malla), y no una columna por
 * muestra.** El motivo es el mismo hueco que la pantalla se cuida de no
 * dibujar: las muestras del mismo producto no siempre miden los mismos tamices
 * —pasa en 4 de los 8 productos con granulometría—, y en formato ancho una
 * malla que **esa** muestra no midió sería una celda vacía al lado de números
 * reales. **Una celda vacía en una planilla se lee como cero**, que es
 * exactamente la medición falsa que no se quiso inventar. En formato largo esa
 * fila sencillamente no existe, que es lo que pasó. De paso la hoja no se
 * ensancha: con seis muestras mide lo mismo que con una.
 *
 * **La malla apagada va igual, con sus números medidos, y marcada.** Esta hoja
 * termina dentro de un informe, lejos de la pantalla que explicaba las cosas.
 * Sacar la fila deja un Excel sin rastro de que esa malla se midió; dejarla sin
 * marcar produce un informe con una fila que el dibujo no tiene, y nadie sabe
 * por qué. Por eso viaja la fila entera y una columna dice si entra al gráfico.
 *
 * Por lo mismo viaja **la nota del acumulado** —sólo si alguna muestra midió
 * alguna de las apagadas— y **el problema de cada muestra tal cual lo escribe
 * `granulometria()`**: reescribirlo sería tener dos textos para una misma cosa.
 * Con más de una muestra, el problema lleva adelante de qué muestra habla.
 *
 * No recibe las mallas que declara el producto y no avisa de las que faltan:
 * se decidió así, igual que en la pantalla.
 */

const DENTRO = "Dentro";
const FUERA = "Fuera";

/** «#20», «#20 y #50», «#20, #50 y #100»: la enumeración como se lee, con su «y». */
function enumerar(mallas: number[]): string {
  const nombres = mallas.map((m) => `#${m}`);
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/**
 * La nota que explica el riesgo asumido de apagar un tamiz. Es la única
 * explicación de todo el cuadro y viaja dentro de un documento que lee alguien
 * de afuera, así que concuerda: «está… ésa retuvo» con una malla, «están…
 * ésas retuvieron» con varias.
 */
function notaDelAcumulado(apagadas: number[]): string {
  const una = apagadas.length === 1;
  return (
    `Nota: ${enumerar(apagadas)} ${una ? "está" : "están"} fuera del gráfico, pero las mallas que ` +
    `le${una ? "" : "s"} siguen ya incluyen lo que ${una ? "ésa retuvo" : "ésas retuvieron"}. ` +
    "El acumulado no se recalcula al apagar un tamiz."
  );
}

/**
 * Los tamices apagados que llegan del navegador en el formulario: un array JSON
 * de números. Cualquier otra cosa, un problema que dice cuál.
 */
export function leerApagadas(crudo: FormDataEntryValue | null): number[] | { problema: string } {
  if (crudo === null || crudo === "") return [];
  if (typeof crudo !== "string") return { problema: "Las mallas apagadas tienen que ir como texto JSON." };

  let valor: unknown;
  try {
    valor = JSON.parse(crudo);
  } catch {
    return { problema: "Las mallas apagadas no son un JSON válido." };
  }
  if (!Array.isArray(valor) || valor.length > 100) {
    return { problema: "Las mallas apagadas tienen que ser una lista de números." };
  }
  if (!valor.every((m) => typeof m === "number" && Number.isFinite(m))) {
    return { problema: "Las mallas apagadas tienen que ser números." };
  }
  return valor as number[];
}

export function filasDeLaHoja(muestras: MuestraParaComparar[], apagadas: number[]): unknown[][] {
  const conProducto = new Set(muestras.map((m) => m.producto)).size > 1;
  const etiquetas = etiquetasDeMuestras(muestras, conProducto);

  // Sin apagar nada, para tener todas las mallas con sus números; `apagadas`
  // sólo sirve para marcar.
  const curvas = muestras.map((m) => curvaDeLaMuestra(m, []));

  const filas: unknown[][] = [
    ["Muestra", "Producto", "Fecha", "Peso tamizado (g)", "Observaciones"],
  ];
  muestras.forEach((m, i) => {
    filas.push([etiquetas[i], m.producto, comoSeLee(m.fecha), m.pesoMuestraG, m.observaciones ?? ""]);
  });

  filas.push([], ["Muestra", "Malla", "Retenido (%)", "Acumulado (%)", "Pasante (%)", "En el gráfico"]);

  const apagadasMedidas = new Set<number>();
  curvas.forEach((curva, i) => {
    for (const p of curva.puntos) {
      const apagada = apagadas.includes(p.malla);
      if (apagada) apagadasMedidas.add(p.malla);
      filas.push([etiquetas[i], p.malla, p.retenido, p.acumulado, p.pasante, apagada ? FUERA : DENTRO]);
    }
  });

  if (apagadasMedidas.size > 0) {
    filas.push([], [notaDelAcumulado([...apagadasMedidas].sort((a, b) => a - b))]);
  }

  const problemas = curvas
    .map((curva, i) =>
      curva.problema === undefined
        ? null
        : muestras.length > 1
          ? `${etiquetas[i]}: ${curva.problema}`
          : curva.problema
    )
    .filter((p): p is string => p !== null);

  if (problemas.length > 0) {
    filas.push([]);
    for (const p of problemas) filas.push([p]);
  }

  return filas;
}
