import { haversineKm, type Punto } from "./geo";

/** TSP por vecino más cercano usando distancia en línea recta (fallback sin matriz OSRM). */
export function vecinoMasCercano<T extends Punto>(inicio: Punto, puntos: T[]): T[] {
  let actual: Punto = inicio;
  const restantes = [...puntos];
  const ruta: T[] = [];
  while (restantes.length) {
    let mejorIdx = 0;
    let mejorD = Infinity;
    restantes.forEach((p, i) => {
      const d = haversineKm(actual, p);
      if (d < mejorD) {
        mejorD = d;
        mejorIdx = i;
      }
    });
    ruta.push(restantes[mejorIdx]);
    actual = restantes[mejorIdx];
    restantes.splice(mejorIdx, 1);
  }
  return ruta;
}

/**
 * TSP por vecino más cercano usando una matriz de duraciones reales (ej. de
 * OSRM). `inicioIdx`/`indicesEmpleados` son posiciones dentro de la misma
 * matriz (índice 0 = punto de partida, típicamente la fábrica).
 */
export function vecinoMasCercanoMatriz(
  inicioIdx: number,
  indicesEmpleados: number[],
  matrizDuraciones: number[][]
): number[] {
  let actualIdx = inicioIdx;
  const restantes = [...indicesEmpleados];
  const ordenados: number[] = [];
  while (restantes.length) {
    let mejorI = 0;
    let mejorD = Infinity;
    restantes.forEach((empIdx, i) => {
      const d = matrizDuraciones[actualIdx][empIdx];
      if (d < mejorD) {
        mejorD = d;
        mejorI = i;
      }
    });
    ordenados.push(restantes[mejorI]);
    actualIdx = restantes[mejorI];
    restantes.splice(mejorI, 1);
  }
  return ordenados;
}
