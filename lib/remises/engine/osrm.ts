import type { Punto } from "./geo";

const OSRM = "https://router.project-osrm.org";

export interface MatrizDistancias {
  duraciones: number[][]; // segundos
  distancias: number[][]; // metros
}

/** Matriz NxN de duraciones/distancias reales entre `puntos`, o null si OSRM no responde. */
export async function getMatrizDistancias(puntos: Punto[]): Promise<MatrizDistancias | null> {
  const coords = puntos.map((p) => `${p.lng},${p.lat}`).join(";");
  try {
    const r = await fetch(`${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.code !== "Ok") return null;
    return { duraciones: d.durations, distancias: d.distances };
  } catch {
    return null;
  }
}

export interface GeometriaRuta {
  geometria: unknown; // GeoJSON LineString
  distanciaKm: number;
  duracionMin: number;
}

/**
 * Geometría real de la ruta entre `waypoints`, en orden. Intenta primero con
 * `continue_straight=true` (evita giros en U en paradas intermedias) y cae a
 * la variante sin esa restricción si falla; devuelve null si OSRM no
 * responde en ningún caso.
 */
export async function getGeometriaRuta(waypoints: Punto[]): Promise<GeometriaRuta | null> {
  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(";");
  const base = `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const parse = (d: any): GeometriaRuta | null =>
    d.code === "Ok" && d.routes.length
      ? { geometria: d.routes[0].geometry, distanciaKm: d.routes[0].distance / 1000, duracionMin: d.routes[0].duration / 60 }
      : null;

  try {
    const r1 = await fetch(base + "&continue_straight=true");
    if (r1.ok) {
      const res = parse(await r1.json());
      if (res) return res;
    }
    const r2 = await fetch(base);
    if (!r2.ok) return null;
    return parse(await r2.json());
  } catch {
    return null;
  }
}
