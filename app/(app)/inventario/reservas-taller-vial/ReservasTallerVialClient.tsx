"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

interface Reserva {
  id: string;
  articulo_codigo: string;
  articulo_descripcion: string;
  stock_actual: number;
  cantidad: number;
  cargado_en: string;
  equipo: string;
  origen: string;
}

export default function ReservasTallerVialClient({ puedeEditar }: { puedeEditar: boolean }) {
  const [reservas, setReservas] = useState<Reserva[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);

  async function cargar() {
    setError(null);
    const res = await fetch("/api/inventario/reservas-taller-vial");
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "No se pudo cargar"); return; }
    setReservas(json.data);
  }

  useEffect(() => { cargar(); }, []);

  async function confirmar(id: string) {
    setProcesando(id);
    setError(null);
    try {
      const res = await fetch(`/api/inventario/reservas-taller-vial/${id}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo confirmar");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar");
    } finally {
      setProcesando(null);
    }
  }

  async function cancelar(id: string) {
    if (!confirm("¿Cancelar esta reserva? No se descuenta nada del pañol.")) return;
    setProcesando(id);
    setError(null);
    try {
      const res = await fetch(`/api/inventario/reservas-taller-vial/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo cancelar");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar");
    } finally {
      setProcesando(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/inventario" className="text-xs text-slate-500 underline">← Inventario</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Reservas de Taller Vial</h1>
        <p className="page-subheader">Repuestos que Taller Vial pidió para un service o una reparación, pendientes de confirmar.</p>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Reservado</th>
                <th>Equipo</th>
                <th>Para</th>
                <th>Artículo</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Stock actual</th>
                {puedeEditar && <th></th>}
              </tr>
            </thead>
            <tbody>
              {reservas === null ? (
                <tr><td colSpan={puedeEditar ? 7 : 6} className="py-8 text-center text-slate-400">Cargando…</td></tr>
              ) : reservas.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 7 : 6} className="py-8 text-center text-slate-400">No hay reservas pendientes.</td></tr>
              ) : (
                reservas.map((r) => {
                  const sinStock = r.stock_actual < r.cantidad;
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-slate-500">{new Date(r.cargado_en).toLocaleDateString("es-AR")}</td>
                      <td className="text-slate-800">{r.equipo}</td>
                      <td className="text-slate-600">{r.origen}</td>
                      <td className="text-slate-800">{r.articulo_codigo} - {r.articulo_descripcion}</td>
                      <td className="text-right font-mono tabular-nums">{num0.format(r.cantidad)}</td>
                      <td className={`text-right font-mono tabular-nums ${sinStock ? "font-semibold text-red-600" : "text-slate-600"}`}>
                        {num0.format(r.stock_actual)}
                      </td>
                      {puedeEditar && (
                        <td className="whitespace-nowrap">
                          <button
                            className="text-xs font-medium text-emerald-700 underline disabled:opacity-40"
                            disabled={procesando === r.id || sinStock}
                            title={sinStock ? "No hay stock suficiente para confirmar" : undefined}
                            onClick={() => confirmar(r.id)}
                          >
                            Confirmar baja
                          </button>
                          <button
                            className="ml-3 text-xs text-slate-400 underline hover:text-red-600 disabled:opacity-40"
                            disabled={procesando === r.id}
                            onClick={() => cancelar(r.id)}
                          >
                            Cancelar
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
