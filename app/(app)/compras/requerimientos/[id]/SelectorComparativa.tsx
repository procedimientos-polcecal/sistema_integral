"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "@/lib/compras/constants";

interface Archivo {
  id: string;
  nombre: string;
  modificado: string;
  esPlanillaGoogle: boolean;
}

/**
 * Elegir de la carpeta de Drive la planilla de comparativa de este pedido.
 *
 * Los nombres son genéricos y a veces no corresponden a lo que pidió el RI, así
 * que esto no se puede adivinar: lo elige la persona. Al elegir, el sistema trae
 * las filas que estén libres o ya sean de este RI.
 */
export default function SelectorComparativa({
  requerimientoId, onListo, onCerrar,
}: {
  requerimientoId: string;
  onListo: (mensaje: string) => void;
  onCerrar: () => void;
}) {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [adjuntando, setAdjuntando] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/compras/comparativas")
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else if (body.aviso) setError(body.aviso);
        else setArchivos(body.archivos ?? []);
      })
      .catch(() => setError("No se pudo leer la carpeta de comparativas."))
      .finally(() => setCargando(false));
  }, []);

  async function adjuntar(archivo: Archivo) {
    setAdjuntando(archivo.id);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/comparativa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drive_id: archivo.id, nombre: archivo.nombre }),
    });
    const body = await res.json().catch(() => ({}));
    setAdjuntando(null);

    if (!res.ok) {
      setError(body.error ?? "No se pudo adjuntar la comparativa.");
      return;
    }

    const partes = [`Se trajeron ${body.traidas} presupuesto(s).`];
    if (body.ajenas > 0) {
      partes.push(`${body.ajenas} fila(s) son de otro RI y se dejaron como estaban.`);
    }
    if (body.sin_precio > 0) partes.push(`${body.sin_precio} fila(s) sin precio se ignoraron.`);
    if (body.proveedores_nuevos?.length) {
      partes.push(`Proveedores nuevos: ${body.proveedores_nuevos.join(", ")}.`);
    }
    if (body.rechazadas?.length) {
      partes.push(
        `No se pudieron cargar ${body.rechazadas.length} fila(s): ${body.rechazadas.join(" · ")}`
      );
    }
    onListo(partes.join(" "));
  }

  const visibles = archivos.filter((a) =>
    a.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8">
      <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Elegir comparativa</h2>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="space-y-3 p-5">
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {error}
            </div>
          )}

          {cargando ? (
            <p className="py-6 text-center text-sm text-slate-400">Leyendo la carpeta…</p>
          ) : visibles.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {archivos.length === 0 ? "No hay archivos en la carpeta." : "Ningún archivo coincide."}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {visibles.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{a.nombre}</p>
                    <p className="text-xs text-slate-400">
                      Modificada {fechaHora(a.modificado)}
                      {!a.esPlanillaGoogle && " · no es una planilla de Google"}
                    </p>
                  </div>
                  <button
                    onClick={() => adjuntar(a)}
                    disabled={!a.esPlanillaGoogle || adjuntando !== null}
                    className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-40"
                  >
                    {adjuntando === a.id ? "Trayendo…" : "Usar esta"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
