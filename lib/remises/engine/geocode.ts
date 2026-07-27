export interface ResultadoGeocode {
  lat: number;
  lng: number;
  display: string;
}

export interface SesgoGeocode {
  ciudad?: string | null;
  fabricaLat?: number | null;
  fabricaLng?: number | null;
}

/**
 * Geocodifica una dirección vía Nominatim (OpenStreetMap), acotado a
 * Argentina. Si hay ciudad de referencia configurada, se agrega a la
 * búsqueda (evita geocodificar en la ciudad equivocada); si no, y hay una
 * fábrica ya geocodificada, se usa un `viewbox` de sesgo alrededor suyo.
 */
export async function geocode(direccion: string, sesgo: SesgoGeocode = {}): Promise<ResultadoGeocode | null> {
  try {
    const query = sesgo.ciudad ? `${direccion}, ${sesgo.ciudad}` : direccion;
    let url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(query)}`;
    if (sesgo.fabricaLat != null && sesgo.fabricaLng != null && !sesgo.ciudad) {
      const d = 0.5;
      const vb = `${sesgo.fabricaLng - d},${sesgo.fabricaLat + d},${sesgo.fabricaLng + d},${sesgo.fabricaLat - d}`;
      url += `&viewbox=${vb}&bounded=0`;
    }
    const r = await fetch(url, { headers: { "Accept-Language": "es" } });
    const data = await r.json();
    if (data.length) return { lat: +data[0].lat, lng: +data[0].lon, display: data[0].display_name };
  } catch {
    // silencioso — igual que el original, se muestra "no encontrado" en la UI
  }
  return null;
}
