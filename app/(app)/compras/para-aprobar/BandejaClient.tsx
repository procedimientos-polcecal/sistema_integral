"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  etiquetaPrioridad, fecha, diasRestantes, moneda, ORDENES_TABLERO,
} from "@/lib/compras/constants";
import type { OrdenTablero } from "@/lib/compras/constants";
import { repartirBandeja } from "@/lib/compras/bandeja";
import ComparativaDecision from "../requerimientos/[id]/ComparativaDecision";
import AprobarSinComparativa from "../AprobarSinComparativa";
import type { RequerimientoConRelaciones, Cotizacion } from "@/lib/compras/types";

/**
 * La bandeja de quien aprueba compras.
 *
 * Arriba lo que espera su decisión, abajo lo que espera a otro. Cada pedido se
 * despliega con su comparativa completa, así se decide sin salir de acá: elegir
 * un presupuesto ES aprobar la compra.
 */
export default function BandejaClient({
  requerimientos, cotizaciones, proveedores, usuarioId,
}: {
  requerimientos: RequerimientoConRelaciones[];
  cotizaciones: Record<string, Cotizacion[]>;
  proveedores: { id: string; nombre: string }[];
  usuarioId: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  // Un solo criterio para los dos bloques: ordenar distinto arriba y abajo
  // hace más difícil comparar una cola con la otra.
  const [orden, setOrden] = useState<OrdenTablero>("prioridad");
  // Qué pedido está mostrando la salida sin comparativa. Con presupuestos
  // cargados va escondida al pie: la comparativa manda la pantalla.
  const [sinComparativa, setSinComparativa] = useState<string | null>(null);
  const [aprobando, setAprobando] = useState<string | null>(null);

  const { mios, deOtros } = repartirBandeja(requerimientos, usuarioId, orden);

  async function elegir(c: Cotizacion) {
    setEligiendo(c.id);
    setError("");
    const res = await fetch(`/api/compras/cotizaciones/${c.id}/elegir`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setEligiendo(null);
    if (!res.ok) {
      setError(body.error ?? "No se pudo aprobar la compra.");
      return;
    }
    setAviso(body.aviso_drive ?? null);
    setAbierto(null);
    router.refresh();
  }

  /**
   * Aprobar sin elegir un presupuesto.
   *
   * Va por el PATCH del requerimiento y no por la ruta de elegir, que necesita
   * una cotización. El proveedor y el costo viajan en el mismo cambio si se
   * cargaron.
   */
  async function aprobarSinComparativa(
    r: RequerimientoConRelaciones,
    datos: { proveedor_id?: string; costo_iva?: number }
  ) {
    setAprobando(r.id);
    setError("");
    const res = await fetch(`/api/compras/requerimientos/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado_compra: "APROBADO", ...datos }),
    });
    const body = await res.json().catch(() => ({}));
    setAprobando(null);

    if (!res.ok) {
      setError(body.error ?? "No se pudo aprobar la compra.");
      return;
    }
    setAviso(body.aviso_sheets ?? null);
    setSinComparativa(null);
    setAbierto(null);
    router.refresh();
  }

  function Pedido({ r, mio }: { r: RequerimientoConRelaciones; mio: boolean }) {
    const suyas = cotizaciones[r.id] ?? [];
    const totales = suyas.map((c) => c.precio_total).filter((t): t is number => t !== null);
    const minimo = totales.length > 0 ? Math.min(...totales) : null;
    const dias = diasRestantes(r.fecha_necesidad);
    const vencido = dias !== null && dias < 0;

    return (
      <article className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/compras/requerimientos/${r.id}`}
                className="font-mono text-xs font-semibold text-[var(--primary)] hover:underline"
              >
                RI {r.nro_ri}
              </Link>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${etiquetaPrioridad(r.prioridad).color}`}>
                {etiquetaPrioridad(r.prioridad).label}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-900">{r.descripcion}</p>
            <p className="text-xs text-slate-500">
              {r.compras_areas?.nombre ?? "Sin área"} · Pedido el {fecha(r.fecha)}
              {r.fecha_necesidad && (
                <span className={vencido ? " font-semibold text-red-600" : ""}>
                  {vencido
                    ? ` · vencido hace ${Math.abs(dias!)} d`
                    : ` · se necesita el ${fecha(r.fecha_necesidad)}`}
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {suyas.length === 0
                ? "Sin presupuestos cargados"
                : `${suyas.length} presupuesto${suyas.length === 1 ? "" : "s"} · el más barato ${moneda(minimo)}`}
            </p>
          </div>

          {mio && (
            <button
              onClick={() => setAbierto(abierto === r.id ? null : r.id)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {abierto === r.id ? "Cerrar" : "Ver y decidir"}
            </button>
          )}
        </div>

        {mio && abierto === r.id && (
          <div className="space-y-4 border-t border-slate-100 px-5 py-4">
            {suyas.length > 0 ? (
              <>
                <ComparativaDecision
                  cotizaciones={suyas}
                  minimo={minimo}
                  onElegir={elegir}
                  eligiendo={eligiendo}
                />

                {/* Con presupuestos cargados la comparativa manda: aprobar sin
                    elegir queda al pie, disponible pero en segundo plano. */}
                {sinComparativa === r.id ? (
                  <div className="border-t border-slate-100 pt-4">
                    <AprobarSinComparativa
                      proveedores={proveedores}
                      presupuestosSinMirar={suyas.length}
                      aprobando={aprobando === r.id}
                      onAprobar={(datos) => aprobarSinComparativa(r, datos)}
                      onCancelar={() => setSinComparativa(null)}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setSinComparativa(r.id)}
                    className="text-xs text-slate-500 underline hover:text-slate-800"
                  >
                    Aprobar sin elegir ninguno
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-slate-500">
                  No hay presupuestos cargados en el sistema.{" "}
                  {r.comparativa_url && (
                    <a href={r.comparativa_url} target="_blank" rel="noreferrer" className="underline">
                      Ver la comparativa en la planilla
                    </a>
                  )}
                </p>

                {/* Sin presupuestos no hay nada que elegir: acá esta es LA
                    acción, no una salida de emergencia. Antes la bandeja no
                    ofrecía ninguna y el pedido quedaba trabado. */}
                <AprobarSinComparativa
                  proveedores={proveedores}
                  presupuestosSinMirar={0}
                  aprobando={aprobando === r.id}
                  onAprobar={(datos) => aprobarSinComparativa(r, datos)}
                />
              </>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Para aprobar</h1>
          <p className="text-sm text-slate-500">
            Compras esperando el visto bueno. Elegir un presupuesto aprueba la compra.
          </p>
        </div>

        {requerimientos.length > 1 && (
          <select
            aria-label="Ordenar la bandeja"
            value={orden}
            onChange={(e) => setOrden(e.target.value as OrdenTablero)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {ORDENES_TABLERO.map((o) => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {aviso && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</div>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Te toca a vos ({mios.length})
        </h2>
        {mios.length === 0 ? (
          <p className="text-sm text-slate-400">No tenés compras esperando tu decisión.</p>
        ) : (
          mios.map((r) => <Pedido key={r.id} r={r} mio />)
        )}
      </section>

      {deOtros.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Esperando a otros ({deOtros.length})
          </h2>
          {deOtros.map((r) => <Pedido key={r.id} r={r} mio={false} />)}
        </section>
      )}
    </div>
  );
}
