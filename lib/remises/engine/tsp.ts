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
      // OSRM devuelve `null` en la matriz para un punto al que no puede llegar
      // manejando, y en JS `null < Infinity` es **true** —el null se convierte
      // en 0—: un domicilio inalcanzable ganaba siempre y quedaba de primera
      // parada, con el resto de la ruta armado desde ahí. Un valor que no es un
      // número se descarta y ese tramo cae al orden que salga.
      const d = matrizDuraciones[actualIdx]?.[empIdx];
      if (typeof d !== "number" || !isFinite(d)) return;
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
