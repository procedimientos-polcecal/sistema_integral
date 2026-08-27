"use client";

import { useCallback, useEffect, useState } from "react";
import {
  aplicarOrdenManual, moverEnLista, asignarOrden, type Ordenable,
} from "@/lib/mantenimiento/prioridad";
import { hoyISO, estaAtrasada } from "@/lib/mantenimiento/alertas";

/**
 * En qué orden hay que hacer el trabajo pendiente.
 *
 * El sistema sugiere uno —lo atrasado primero, después lo urgente, después lo
 * que espera hace más— y acá se puede cambiar. Es lo que sabe quien reparte el
 * trabajo y los datos no: que el repuesto llega el jueves, que conviene
 * aprovechar que el sector está parado.
 *
 * Sólo las pendientes: poner en fila las mil setecientas que ya se hicieron no
 * le sirve a nadie.
 */

interface OT extends Ordenable {
  descripcion: string | null;
  equipo_raw: string | null;
  sector_raw: string | null;
  estado: string | null;
}

export default function OrdenarTrabajo({ puedeEditar }: { puedeEditar: boolean }) {
  const [ordenes, setOrdenes] = useState<OT[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [arrastrando, setArrastrando] = useState<number | null>(null);

  const hoy = hoyISO();

  const traer = useCallback(async () => {
    setCargando(true);
    const res = await fetch("/api/mantenimiento/ordenes?pendientes=1");
    setCargando(false);

    if (!res.ok) { setError("No se pudieron traer las órdenes."); return; }
    const body = await res.json();
    setOrdenes(aplicarOrdenManual<OT>(body.data ?? [], hoy));
  }, [hoy]);

  useEffect(() => { traer(); }, [traer]);

  /** Guarda la lista tal como quedó. */
  async function guardar(lista: OT[]) {
    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/ordenes/orden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: asignarOrden(lista) }),
    });
    setGuardando(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar el orden.");
      // Se vuelve a traer para no dejar en pantalla un orden que no se guardó.
      traer();
    }
  }

  function mover(desde: number, hasta: number) {
    const lista = moverEnLista(ordenes, desde, hasta);
    if (lista === ordenes) return;
    setOrdenes(lista);
    guardar(lista);
  }

  async function volverAlSugerido() {
    setGuardando(true);
    setError("");
    const res = await fetch("/api/mantenimiento/ordenes/orden", { method: "DELETE" });
    setGuardando(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo volver al orden sugerido.");
      return;
    }
    traer();
  }

  const hayOrdenPropio = ordenes.some((o) => o.orden_manual !== null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-gray-500">
          {cargando
            ? "Cargando…"
            : `${ordenes.length} órdenes esperando. ` +
              (hayOrdenPropio
                ? "El orden es el que pusieron acá."
                : "El orden lo sugiere el sistema: lo atrasado primero, después lo urgente.")}
        </p>

        {puedeEditar && hayOrdenPropio && (
          <button
            onClick={volverAlSugerido}
            disabled={guardando}
            className="text-xs font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            Volver al orden sugerido
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {!cargando && ordenes.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-400">
          No hay órdenes esperando. Todo lo que hay está realizado.
        </p>
      ) : (
        <ol className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {ordenes.map((o, i) => (
            <li
              key={o.id}
              draggable={puedeEditar}
              onDragStart={() => setArrastrando(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (arrastrando !== null) mover(arrastrando, i); setArrastrando(null); }}
              onDragEnd={() => setArrastrando(null)}
              className={`flex items-center gap-3 px-3 py-2.5 ${
                arrastrando === i ? "bg-gray-100 opacity-50" : "hover:bg-gray-50"
              } ${puedeEditar ? "cursor-grab" : ""}`}
            >
              <span className="w-6 shrink-0 text-center text-xs font-bold text-gray-400">{i + 1}</span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-900">
                  <span className="font-mono text-xs text-gray-400">#{o.ot_number}</span>{" "}
                  {o.descripcion ?? o.equipo_raw ?? "—"}
                </p>
                <p className="truncate text-xs text-gray-400">
                  {o.sector_raw ?? "sin sector"}
                  {o.equipo_raw && o.descripcion ? ` · ${o.equipo_raw}` : ""}
                </p>
              </div>

              {estaAtrasada(o, hoy) && (
                <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                  atrasada
                </span>
              )}
              {String(o.prioridad ?? "").toUpperCase() === "ALTA" && (
                <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                  alta
                </span>
              )}

              {/* Los botones no son un adorno: arrastrar no anda en el teléfono,
                  que es desde donde se mira esto parado al lado de la máquina. */}
              {puedeEditar && (
                <div className="flex shrink-0 flex-col">
                  <button
                    onClick={() => mover(i, i - 1)}
                    disabled={i === 0 || guardando}
                    className="px-1 text-xs leading-none text-gray-400 hover:text-gray-800 disabled:opacity-25"
                    title="Subir"
                  >▲</button>
                  <button
                    onClick={() => mover(i, i + 1)}
                    disabled={i === ordenes.length - 1 || guardando}
                    className="px-1 text-xs leading-none text-gray-400 hover:text-gray-800 disabled:opacity-25"
                    title="Bajar"
                  >▼</button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {guardando && <p className="text-right text-xs text-gray-400">Guardando…</p>}
    </div>
  );
}
