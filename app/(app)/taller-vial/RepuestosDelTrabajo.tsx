"use client";

import { useEffect, useState } from "react";

/**
 * Los repuestos del pañol reservados para un service o una reparación
 * puntual, con el buscador para reservar uno nuevo. Reservar no descuenta
 * stock — sólo Inventario, desde "Reservas de Taller Vial", confirma la baja
 * real. Compartido entre `/taller-vial/services` y `/taller-vial/reparaciones`
 * porque la lógica es idéntica, sólo cambia si el origen es un service o una
 * reparación.
 */

interface RepuestoFila {
  id: string;
  articulo_codigo: string;
  articulo_descripcion: string;
  cantidad: number;
  estado: "reservado" | "confirmado";
}

interface ArticuloOpcion {
  id: string;
  codigo: string;
  descripcion: string;
  stock_actual: number;
}

export default function RepuestosDelTrabajo({
  serviceId, reparacionId, puedeEditar,
}: {
  serviceId?: string;
  reparacionId?: string;
  puedeEditar: boolean;
}) {
  const [repuestos, setRepuestos] = useState<RepuestoFila[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [opciones, setOpciones] = useState<ArticuloOpcion[]>([]);
  const [seleccionado, setSeleccionado] = useState<ArticuloOpcion | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const paramOrigen = serviceId ? `service_id=${serviceId}` : `reparacion_id=${reparacionId}`;

  async function cargar() {
    const res = await fetch(`/api/taller-vial/repuestos?${paramOrigen}`);
    const json = await res.json();
    if (res.ok) setRepuestos(json.data);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- se busca una sola vez al montar, por origen
  useEffect(() => { cargar(); }, []);

  useEffect(() => {
    if (seleccionado || busqueda.trim().length < 3) { setOpciones([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/taller-vial/inventario?q=${encodeURIComponent(busqueda)}`);
      const json = await res.json();
      if (res.ok) setOpciones(json.data);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, seleccionado]);

  async function reservar() {
    if (!seleccionado) { setError("Elegí un artículo del pañol"); return; }
    const n = Number(cantidad.replace(",", "."));
    if (!isFinite(n) || n <= 0) { setError("La cantidad tiene que ser mayor a cero"); return; }

    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch("/api/taller-vial/repuestos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: serviceId ?? null,
          reparacion_id: reparacionId ?? null,
          articulo_id: seleccionado.id,
          cantidad: n,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo reservar");
      if (json.aviso) setAviso(json.aviso.mensaje);
      setSeleccionado(null);
      setBusqueda("");
      setCantidad("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reservar");
    } finally {
      setGuardando(false);
    }
  }

  async function cancelar(id: string) {
    if (!confirm("¿Cancelar esta reserva? No se descontó nada todavía.")) return;
    const res = await fetch(`/api/taller-vial/repuestos?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "No se pudo cancelar"); return; }
    await cargar();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      {repuestos === null ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : repuestos.length === 0 ? (
        <p className="text-xs text-slate-400">Sin repuestos reservados.</p>
      ) : (
        <ul className="space-y-1">
          {repuestos.map((r) => (
            <li key={r.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-700">{r.articulo_codigo} - {r.articulo_descripcion} × {r.cantidad}</span>
              <span className="flex items-center gap-2">
                <span className={r.estado === "confirmado" ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
                  {r.estado === "confirmado" ? "Confirmado" : "Reservado"}
                </span>
                {puedeEditar && r.estado === "reservado" && (
                  <button className="text-slate-400 underline hover:text-red-600" onClick={() => cancelar(r.id)}>Cancelar</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {puedeEditar && (
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <input
              className="input"
              placeholder="Buscar artículo del pañol…"
              value={seleccionado ? `${seleccionado.codigo} - ${seleccionado.descripcion}` : busqueda}
              onChange={(e) => { setSeleccionado(null); setBusqueda(e.target.value); }}
            />
            {!seleccionado && opciones.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                {opciones.map((o) => (
                  <li key={o.id}>
                    <button
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                      onClick={() => { setSeleccionado(o); setOpciones([]); }}
                    >
                      {o.codigo} - {o.descripcion} <span className="text-slate-400">(quedan {o.stock_actual})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input className="input w-24" inputMode="decimal" placeholder="Cant." value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          <button className="btn-secondary shrink-0" disabled={guardando} onClick={reservar}>Reservar</button>
        </div>
      )}
      {aviso && <p className="mt-1 text-xs text-amber-700">{aviso}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
