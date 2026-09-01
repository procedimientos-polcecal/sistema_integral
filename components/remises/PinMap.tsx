"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// El ícono default de Leaflet referencia rutas relativas que no resuelven
// bien con el bundler de Next — se apunta directo al CDN, igual que hacía
// el original (que cargaba Leaflet completo desde unpkg).
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const CARTO_TILES = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  opts: {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  },
};

const DEFAULT_CENTER: [number, number] = [-34.6037, -58.3816]; // Buenos Aires, fallback sin fábrica configurada

/** Mapa Leaflet con un pin único, clickeable para reubicarlo. Sin SSR (solo cliente). */
export default function PinMap({
  lat,
  lng,
  onChange,
  height = 260,
  popup,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
  popup?: string;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // El ref existe para que el `map.on("click")` de abajo llame siempre al
  // `onChange` mas reciente sin volver a montar el mapa. Actualizarlo estaba
  // hecho **durante el render**, que en React 19 es una mutacion en una fase que
  // puede correrse o descartarse: el handler podia quedar apuntando a un
  // callback de un render que nunca se llego a mostrar. Va en un efecto, que es
  // la fase donde escribir un ref es valido.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const center: [number, number] = lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;
    const map = L.map(elRef.current).setView(center, lat != null ? 15 : 12);
    L.tileLayer(CARTO_TILES.url, CARTO_TILES.opts).addTo(map);
    if (lat != null && lng != null) {
      markerRef.current = L.marker([lat, lng]).addTo(map).bindPopup(popup ?? "").openPopup();
    }
    map.on("click", (e) => {
      const { lat: newLat, lng: newLng } = e.latlng;
      if (markerRef.current) map.removeLayer(markerRef.current);
      markerRef.current = L.marker([newLat, newLng]).addTo(map).bindPopup(popup ?? "").openPopup();
      onChangeRef.current(newLat, newLng);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || lat == null || lng == null) return;
    mapRef.current.setView([lat, lng], 15);
    if (markerRef.current) mapRef.current.removeLayer(markerRef.current);
    markerRef.current = L.marker([lat, lng]).addTo(mapRef.current).bindPopup(popup ?? "").openPopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return <div ref={elRef} style={{ height }} className="rounded-lg overflow-hidden border border-gray-200" />;
}
