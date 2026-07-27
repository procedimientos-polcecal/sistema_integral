import { haversineKm, type Punto } from "./geo";

/**
 * K-means (con seeding estilo k-means++) sobre puntos geográficos. Devuelve
 * un array paralelo a `puntos` con el índice de cluster (0..k-1) asignado a
 * cada uno. Usa `Math.random()` para el seeding — no determinístico, igual
 * que el original (los tests verifican invariantes, no un resultado exacto).
 */
export function kMeans(puntos: Punto[], k: number, iters = 15): number[] {
  if (k >= puntos.length) return puntos.map((_, i) => i % k);

  const centroides: Punto[] = [puntos[0]];
  while (centroides.length < k) {
    const distancias = puntos.map((p) => Math.min(...centroides.map((c) => haversineKm(p, c))));
    const total = distancias.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let agregado = false;
    for (let i = 0; i < puntos.length; i++) {
      r -= distancias[i];
      if (r <= 0) {
        centroides.push(puntos[i]);
        agregado = true;
        break;
      }
    }
    if (!agregado && centroides.length < k) centroides.push(puntos[centroides.length]);
  }

  let asignacion = new Array(puntos.length).fill(0);
  let centros = centroides;
  for (let it = 0; it < iters; it++) {
    asignacion = puntos.map((p) => {
      let mejorIdx = 0;
      let mejorDist = Infinity;
      centros.forEach((c, i) => {
        const d = haversineKm(p, c);
        if (d < mejorDist) {
          mejorDist = d;
          mejorIdx = i;
        }
      });
      return mejorIdx;
    });
    centros = centros.map((centroActual, ci) => {
      const cluster = puntos.filter((_, pi) => asignacion[pi] === ci);
      if (!cluster.length) return centroActual;
      return {
        lat: cluster.reduce((s, p) => s + p.lat, 0) / cluster.length,
        lng: cluster.reduce((s, p) => s + p.lng, 0) / cluster.length,
      };
    });
  }
  return asignacion;
}

/**
 * Clustering geográfico que respeta la capacidad de cada vehículo. Arranca
 * con k-means y rebalancea: mueve empleados de clusters saturados al
 * cluster vecino más cercano que todavía tiene espacio, hasta que todos
 * quedan dentro de capacidad (o no hay más espacio disponible en ningún
 * cluster — devuelve el mejor esfuerzo, no bloquea).
 */
export function clusterConCapacidad(empleados: Punto[], capacidades: number[]): number[] {
  const k = capacidades.length;
  if (!k) return [];
  if (k === 1 || empleados.length <= 1) return empleados.map(() => 0);

  const caps = capacidades.map((c) => Math.max(1, c || 8));
  const asignacion = kMeans(empleados, k).slice();
  const maxPasadas = empleados.length * k * 2;

  for (let pasada = 0; pasada < maxPasadas; pasada++) {
    const conteos = Array(k).fill(0);
    asignacion.forEach((c) => conteos[c]++);
    const saturado = conteos.findIndex((c, i) => c > caps[i]);
    if (saturado === -1) break;

    let mejorEi = -1;
    let mejorCi = -1;
    let mejorD = Infinity;
    for (let ei = 0; ei < empleados.length; ei++) {
      if (asignacion[ei] !== saturado) continue;
      for (let ci = 0; ci < k; ci++) {
        if (ci === saturado || conteos[ci] >= caps[ci]) continue;
        const miembros = empleados.filter((_, j) => asignacion[j] === ci);
        const d = miembros.length
          ? haversineKm(empleados[ei], {
              lat: miembros.reduce((s, e) => s + e.lat, 0) / miembros.length,
              lng: miembros.reduce((s, e) => s + e.lng, 0) / miembros.length,
            })
          : haversineKm(empleados[ei], empleados[Math.floor(empleados.length / 2)]);
        if (d < mejorD) {
          mejorD = d;
          mejorEi = ei;
          mejorCi = ci;
        }
      }
    }
    if (mejorEi === -1) break;
    asignacion[mejorEi] = mejorCi;
  }

  return asignacion;
}
