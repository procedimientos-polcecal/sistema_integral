"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import TraerDeLaPlanilla from "./TraerDeLaPlanilla";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

export interface ArticuloEnPantalla {
  id: string;
  codigo: string;
  descripcion: string;
  grupo: string | null;
  stock_actual: number;
  stock_seguridad: number;
  faltante: number;
}

/**
 * El stock de envases.
 *
 * Ordenado por faltante, que es lo que ordena el trabajo: lo primero que se ve
 * es lo que hay que comprar.
 *
 * El número **es lo que dijo la planilla**, no un cálculo del SdG: la columna de
 * stock allá es una fórmula sobre el kardex y eso la vuelve el stock consolidado
 * correcto. Por eso la fecha de la última lectura va arriba y no escondida — un
 * número sin fecha se lee como si fuera de ahora.
 */
export default function StockClient({
  articulos, puedeOperar, sync,
}: {
  articulos: ArticuloEnPantalla[];
  puedeOperar: boolean;
  sync: UltimaSync | null;
}) {
  const [q, setQ] = useState("");
  const [soloFaltantes, setSoloFaltantes] = useState(false);

  const visibles = useMemo(() => {
    const termino = q.trim().toLowerCase();
    return articulos.filter((a) => {
      if (soloFaltantes && a.faltante <= 0) return false;
      if (!termino) return true;
      return (
        a.codigo.toLowerCase().includes(termino) ||
        a.descripcion.toLowerCase().includes(termino) ||
        (a.grupo ?? "").toLowerCase().includes(termino)
      );
    });
  }, [articulos, q, soloFaltantes]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stock de envases</h1>
          <p className="text-sm text-slate-500">
            Lo que hay, según la última lectura de la planilla.
          </p>
        </div>
        {puedeOperar && (
          <Link
            href="/calidad/envases/movimientos"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Cargar movimiento
          </Link>
        )}
      </div>

      <TraerDeLaPlanilla sync={sync} />

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por código, descripción o grupo"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloFaltantes}
            onChange={(e) => setSoloFaltantes(e.target.checked)}
          />
          Sólo faltantes
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Grupo</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Seguridad</th>
              <th className="px-3 py-2 text-right">Falta</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{a.codigo}</td>
                <td className="px-3 py-2 text-slate-900">{a.descripcion}</td>
                <td className="px-3 py-2 text-slate-500">
                  {/* Sin grupo no es un error del artículo: la columna que
                      agrupa vive en el kardex, así que uno que nunca se movió no
                      tiene ninguno. Se dice, no se disimula. */}
                  {a.grupo ?? <span className="italic text-slate-400">sin grupo</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{a.stock_actual}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {a.stock_seguridad}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    a.faltante > 0 ? "font-semibold text-red-600" : "text-slate-400"
                  }`}
                >
                  {a.faltante > 0 ? a.faltante : "—"}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  {articulos.length === 0
                    ? "Todavía no se trajo nada de la planilla."
                    : "Ningún artículo coincide."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
