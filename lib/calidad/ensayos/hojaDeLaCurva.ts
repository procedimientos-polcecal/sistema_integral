import { comoSeLee } from "@/lib/core/fechas";
import { curvaDeLaMuestra } from "./curva";

/**
 * Las filas del Excel de la curva granulométrica, tal cual van al `.xlsx`.
 *
 * **La malla apagada va igual, con sus números medidos, y marcada.** Esta hoja
 * termina dentro de un informe, lejos de la pantalla que explicaba las cosas.
 * Sacar la fila deja un Excel sin rastro de que esa malla se midió; dejarla sin
 * marcar produce un informe con una fila que el dibujo no tiene, y nadie sabe
 * por qué. Por eso viaja la fila entera y una quinta columna dice si entra al
 * gráfico.
 *
 * Por lo mismo viaja **la nota del acumulado** —sólo si hay alguna malla
 * apagada—, y **el problema de la muestra tal cual lo escribe
 * `granulometria()`**: reescribirlo sería tener dos textos para una misma cosa.
 *
 * No recibe las mallas que declara el producto y no avisa de las que faltan:
 * se decidió así, igual que en la pantalla.
 */

export interface EncabezadoDeLaHoja {
  producto: string;
  /** ISO, como viene de la base. */
  fecha: string;
  observaciones: string | null;
}

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

export function filasDeLaHoja(
  ensayo: { pesoMuestraG: number | null; retenidos: { malla: number; retenido_g: number }[] },
  apagadas: number[],
  encabezado: EncabezadoDeLaHoja
): unknown[][] {
  // Sin apagar nada, para tener todas las mallas con sus números; `apagadas`
  // sólo sirve para marcar.
  const { puntos, problema } = curvaDeLaMuestra(ensayo, []);

  const filas: unknown[][] = [
    ["Producto", encabezado.producto],
    ["Fecha", comoSeLee(encabezado.fecha)],
    ["Peso de la muestra (g)", ensayo.pesoMuestraG],
  ];
  if (encabezado.observaciones) filas.push(["Observaciones", encabezado.observaciones]);

  filas.push([], ["Malla", "Retenido (%)", "Acumulado (%)", "Pasante (%)", "En el gráfico"]);

  const apagadasMedidas: number[] = [];
  for (const p of puntos) {
    const apagada = apagadas.includes(p.malla);
    if (apagada) apagadasMedidas.push(p.malla);
    filas.push([p.malla, p.retenido, p.acumulado, p.pasante, apagada ? FUERA : DENTRO]);
  }

  if (apagadasMedidas.length > 0) {
    filas.push([], [notaDelAcumulado(apagadasMedidas)]);
  }

  if (problema) filas.push([], [problema]);

  return filas;
}
