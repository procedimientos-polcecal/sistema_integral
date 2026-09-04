"use client";

import { useCallback, useEffect, useState } from "react";
import TraerDeLaPlanilla from "../TraerDeLaPlanilla";
import { useArranqueDeLaUrl, useEspejoEnLaUrl } from "@/lib/core/usarLaUrl";
import {
  leerFiltrosDeArticulos, escribirFiltrosDeArticulos,
} from "@/lib/inventario/filtrosUrl";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

interface Articulo {
  id: string;
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  stock_actual: number;
  stock_seguridad: number;
  faltante: number;
  stock_sincronizado_en: string | null;
}

/**
 * El catálogo de artículos.
 *
 * Se edita lo que decide una persona —la descripción, dónde está, el stock de
 * seguridad— y **no el stock**, que sale de las fórmulas de la planilla. Tocarlo
 * acá crearía un número que la próxima sincronización pisa sin avisar; para
 * corregir cuánto hay se carga un ajuste, que además deja quién lo contó.
 *
 * Los artículos nuevos tampoco se dan de alta acá: nacen en la planilla, que es
 * de donde salen los códigos.
 */
export default function ArticulosClient({
  esAdmin, sync,
}: {
  esAdmin: boolean;
  sync: UltimaSync | null;
}) {
  // El buscador también va en la URL: acá se viene a buscar un artículo
  // puntual, y `?q=rodamiento` es lo que se recarga o se pasa por chat.
  const arranque = useArranqueDeLaUrl(leerFiltrosDeArticulos);
  const [q, setQ] = useState(arranque.busqueda);
  useEspejoEnLaUrl(escribirFiltrosDeArticulos({ busqueda: q }));
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Articulo | null>(null);

  const buscar = useCallback(async (termino: string) => {
    setCargando(true);
    const res = await fetch(`/api/inventario/articulos?q=${encodeURIComponent(termino)}`);
    const body = await res.json().catch(() => ({}));
    setCargando(false);
    if (!res.ok) { setError(body.error ?? "No se pudo buscar."); return; }
    setArticulos(body.data ?? []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => buscar(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, buscar]);

  async function guardar(a: Articulo, cambios: Partial<Articulo>) {
    setError("");
    const res = await fetch(`/api/inventario/articulos/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cambios),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return;
    }
    setEditando(null);
    buscar(q.trim());
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Artículos</h1>
        <p className="text-sm text-slate-500">
          El catálogo del almacén. Los códigos y el stock los pone la planilla;
          acá se edita lo que decide una persona.
        </p>
      </div>

      {/* Los artículos nuevos nacen en la planilla, así que este es el botón
          que los hace aparecer acá. */}
      <TraerDeLaPlanilla sync={sync} onListo={() => buscar(q.trim())} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por código o descripción…"
        className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="px-3 py-2 text-left">Ubicación</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">Seguridad</th>
                {esAdmin && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={esAdmin ? 6 : 5} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : articulos.length === 0 ? (
                <tr><td colSpan={esAdmin ? 6 : 5} className="px-3 py-10 text-center text-slate-400">
                  Ningún artículo coincide.
                </td></tr>
              ) : (
                articulos.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-slate-700">{a.codigo}</td>
                    <td className="px-3 py-2 text-slate-900">{a.descripcion}</td>
                    <td className="px-3 py-2 text-slate-600">{a.ubicacion ?? "—"}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${a.faltante > 0 ? "text-red-600" : "text-slate-700"}`}>
                      {a.stock_actual}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{a.stock_seguridad}</td>
                    {esAdmin && (
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setEditando(a)}
                          className="text-xs text-slate-500 hover:text-slate-900"
                        >
                          Editar
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        El stock no se edita: sale de las fórmulas de la planilla. Para corregir
        cuánto hay se carga un ajuste, que además deja constancia de quién lo
        contó.
      </p>

      {editando && (
        <ModalArticulo
          articulo={editando}
          onCerrar={() => setEditando(null)}
          onGuardar={(cambios) => guardar(editando, cambios)}
        />
      )}
    </div>
  );
}

function ModalArticulo({
  articulo, onCerrar, onGuardar,
}: {
  articulo: Articulo;
  onCerrar: () => void;
  onGuardar: (cambios: Partial<Articulo>) => void;
}) {
  const [descripcion, setDescripcion] = useState(articulo.descripcion);
  const [ubicacion, setUbicacion] = useState(articulo.ubicacion ?? "");
  const [seguridad, setSeguridad] = useState(String(articulo.stock_seguridad));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="mt-16 w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            <span className="font-mono text-sm text-slate-500">{articulo.codigo}</span>
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Descripción</span>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Ubicación</span>
            <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Stock de seguridad</span>
            <input type="number" min="0" step="any" value={seguridad}
              onChange={(e) => setSeguridad(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <span className="mt-1 block text-xs text-slate-500">
              Debajo de este número, el artículo aparece como faltante.
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={() => onGuardar({
              descripcion: descripcion.trim(),
              ubicacion: ubicacion.trim() || null,
              stock_seguridad: Number(seguridad) || 0,
            })}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
