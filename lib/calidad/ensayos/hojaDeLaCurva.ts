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
    const cuales = apagadasMedidas.map((m) => `#${m}`).join(", ");
    filas.push(
      [],
      [
        `Nota: ${cuales} está fuera del gráfico, pero las mallas que le siguen ya incluyen lo que ésa retuvo. ` +
          "El acumulado no se recalcula al apagar un tamiz.",
      ]
    );
  }

  if (problema) filas.push([], [problema]);

  return filas;
}
