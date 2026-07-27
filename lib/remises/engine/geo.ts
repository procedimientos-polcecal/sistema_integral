export interface Punto {
  lat: number;
  lng: number;
}

/** Distancia en línea recta entre dos puntos (km), fórmula de Haversine. */
export function haversineKm(a: Punto, b: Punto): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Suma de distancias en línea recta entre paradas consecutivas (fallback cuando OSRM no está disponible). */
export function distanciaRuta(paradas: Punto[]): number {
  let total = 0;
  for (let i = 0; i < paradas.length - 1; i++) total += haversineKm(paradas[i], paradas[i + 1]);
  return total;
}
