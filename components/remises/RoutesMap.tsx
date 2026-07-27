"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

const CARTO_TILES = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  opts: {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  },
};

export interface HojaParaMapa {
  id: string;
  tipo: "ida" | "vuelta";
  geometria: any;
  asientos: { empleado_id: string; empleados: { nombre: string; apellido: string; remises_empleados_datos: { direccion: string | null; lat: number | null; lng: number | null } | null } }[];
}

/** Mapa Leaflet con las rutas del día: polilínea real (OSRM) o línea recta de respaldo, con marcadores numerados y el marcador de fábrica. */
export default function RoutesMap({
  hojas,
  fabrica,
}: {
  hojas: HojaParaMapa[];
  fabrica: { lat: number | null; lng: number | null; nombre: string };
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const center: [number, number] = fabrica.lat != null ? [fabrica.lat, fabrica.lng!] : [-34.6037, -58.3816];
    const map = L.map(elRef.current).setView(center, 12);
    L.tileLayer(CARTO_TILES.url, CARTO_TILES.opts).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layersRef.current.forEach((l) => map.removeLayer(l));
    layersRef.current = [];
    if (!hojas.length || fabrica.lat == null) return;

    const allPts: [number, number][] = [];

    hojas.forEach((hoja, ri) => {
      const color = COLORS[ri % COLORS.length];
      const puntos = hoja.asientos
        .map((a) => {
          const d = a.empleados.remises_empleados_datos;
          return d?.lat != null && d?.lng != null
            ? { lat: Number(d.lat), lng: Number(d.lng), nombre: `${a.empleados.apellido}, ${a.empleados.nombre}`, direccion: d.direccion }
            : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      if (hoja.geometria?.coordinates?.length > 1) {
        const latlngs = hoja.geometria.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
        const l = L.polyline(latlngs, { color, weight: 5, opacity: 0.8, dashArray: hoja.tipo === "ida" ? "10,5" : undefined }).addTo(map);
        layersRef.current.push(l);
      } else if (puntos.length > 0) {
        const secuencia = hoja.tipo === "ida" ? [...puntos, fabrica] : [fabrica, ...puntos];
        const l = L.polyline(secuencia.map((p) => [p.lat!, p.lng!]), { color, weight: 4, opacity: 0.7, dashArray: hoja.tipo === "ida" ? "8,4" : undefined }).addTo(map);
        layersRef.current.push(l);
      }

      puntos.forEach((p, si) => {
        const icon = L.divIcon({
          html: `<div style="background:${color};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">${si + 1}</div>`,
          className: "",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const m = L.marker([p.lat!, p.lng!], { icon }).addTo(map).bindPopup(`<b>${p.nombre}</b><br><small>${p.direccion ?? ""}</small>`);
        layersRef.current.push(m);
        allPts.push([p.lat!, p.lng!]);
      });
    });

    const iconFabrica = L.divIcon({
      html: `<div style="background:#f59e0b;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">F</div>`,
      className: "",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const mf = L.marker([fabrica.lat, fabrica.lng!], { icon: iconFabrica }).addTo(map).bindPopup(fabrica.nombre);
    layersRef.current.push(mf);
    allPts.push([fabrica.lat, fabrica.lng!]);

    if (allPts.length) map.fitBounds(allPts, { padding: [30, 30] });
  }, [hojas, fabrica]);

  return <div ref={elRef} className="w-full h-full rounded-xl overflow-hidden border border-gray-200" />;
}
