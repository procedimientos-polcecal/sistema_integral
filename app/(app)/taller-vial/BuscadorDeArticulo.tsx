"use client";

import { useEffect, useState } from "react";

/**
 * Buscar en el pañol, para elegir qué repuesto reservar — compartido entre
 * el formulario de carga y `RepuestosDelTrabajo`.
 *
 * Con `equipoId`, el servidor acota la búsqueda al modelo de ese equipo
 * (`lib/tallerVial/equipos.ts`) — acá sólo importa que, cuando hay un
 * equipo elegido, se puede buscar sin escribir nada todavía (el server
 * decide si hay un término para acotar; si no lo hay, ahí sí hace falta
 * escribir para no traer las 1.157 filas del pañol entero).
 */

export interface ArticuloOpcion {
  id: string;
  codigo: string;
  descripcion: string;
  stock_actual: number;
}

export default function BuscadorDeArticulo({
  onElegir, equipoId, placeholder = "Buscar artículo del pañol…",
}: {
  onElegir: (articulo: ArticuloOpcion) => void;
  /** Acota la búsqueda al modelo de este equipo, si se conoce. */
  equipoId?: string;
  placeholder?: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [opciones, setOpciones] = useState<ArticuloOpcion[]>([]);

  useEffect(() => {
    if (!equipoId && busqueda.trim().length < 3) { setOpciones([]); return; }
    const t = setTimeout(async () => {
      const params = new URLSearchParams();
      if (busqueda.trim()) params.set("q", busqueda.trim());
      if (equipoId) params.set("equipo_id", equipoId);
      const res = await fetch(`/api/taller-vial/inventario?${params}`);
      const json = await res.json();
      if (res.ok) setOpciones(json.data);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, equipoId]);

  return (
    <div className="relative">
      <input className="input" placeholder={placeholder} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      {opciones.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          {opciones.map((o) => (
            <li key={o.id}>
              <button
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                onClick={() => { onElegir(o); setBusqueda(""); setOpciones([]); }}
              >
                {o.codigo} - {o.descripcion} <span className="text-slate-400">(quedan {o.stock_actual})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!equipoId && busqueda.trim().length > 0 && busqueda.trim().length < 3 && (
        <p className="mt-1 text-xs text-slate-400">Escribí al menos 3 letras.</p>
      )}
    </div>
  );
}
