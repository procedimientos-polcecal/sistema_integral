"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moneda, fecha } from "@/lib/compras/constants";
import type { Cotizacion, RequerimientoConRelaciones } from "@/lib/compras/types";
import SelectorComparativa from "./SelectorComparativa";
import PresupuestoForm from "./PresupuestoForm";

/**
 * La comparativa de un requerimiento.
 *
 * Compras adjunta la planilla de Drive, carga los presupuestos y designa a
 * quién le toca. La persona asignada aprueba la compra eligiendo uno: elegir es
 * el acto de aprobar, no un paso previo.
 *
 * Al aprobarse la compra la comparativa se congela: es el respaldo de por qué se
 * eligió ese precio.
 */
export default function Comparativa({
  requerimiento: r, cotizaciones, proveedores, puedeEditar, esAsignado,
}: {
  requerimiento: RequerimientoConRelaciones;
  cotizaciones: Cotizacion[];
  proveedores: { id: string; nombre: string }[];
  puedeEditar: boolean;
  esAsignado: boolean;
}) {
  const router = useRouter();
  const [selector, setSelector] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [trayendo, setTrayendo] = useState(false);

  const congelada = ["APROBADO", "PEDIDO", "RECIBIDO"].includes(r.estado_compra);
  const puedeCargar = puedeEditar && !congelada && r.estado_aprobacion === "APROBADA";
  const puedeElegir = esAsignado && r.estado_compra === "PARA_COMPRAR";

  // Ordenadas por total: el más barato primero. Es información, no una
  // decisión — el plazo, la disponibilidad y la marca también pesan.
  const ordenadas = [...cotizaciones].sort(
    (a, b) => (a.precio_total ?? Infinity) - (b.precio_total ?? Infinity)
  );
  const masBarato = ordenadas.find((c) => c.precio_total !== null)?.id;
  const hoy = new Date().toISOString().slice(0, 10);

  function refrescar(mensaje: string | null) {
    setAviso(mensaje);
    setSelector(false);
    setCargando(false);
    router.refresh();
  }

  /**
   * Relee la planilla adjunta.
   *
   * Se borran los presupuestos que habían venido de Drive —sobre esos manda la
   * planilla— y quedan intactos los que se cargaron acá. Lo resuelve la misma
   * ruta que adjuntar: es idempotente a propósito.
   */
  async function volverATraer() {
    if (!r.comparativa_drive_id) return;
    setTrayendo(true);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${r.id}/comparativa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drive_id: r.comparativa_drive_id, nombre: r.comparativa_nombre }),
    });
    const body = await res.json().catch(() => ({}));
    setTrayendo(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo releer la planilla.");
      return;
    }
    refrescar(`Se releyó la planilla: ${body.traidas} presupuesto(s).`);
  }

  async function elegir(cotizacion: Cotizacion) {
    setEligiendo(cotizacion.id);
    setError("");
    const res = await fetch(`/api/compras/cotizaciones/${cotizacion.id}/elegir`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setEligiendo(null);
    if (!res.ok) {
      setError(body.error ?? "No se pudo aprobar la compra.");
      return;
    }
    refrescar(body.aviso_drive ?? null);
  }

  async function borrar(cotizacion: Cotizacion) {
    if (!confirm(`¿Borrar el presupuesto de ${cotizacion.proveedores?.nombre ?? "ese proveedor"}?`)) {
      return;
    }
    const res = await fetch(`/api/compras/cotizaciones/${cotizacion.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No se pudo borrar.");
      return;
    }
    refrescar(body.aviso_drive ?? null);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Comparativa de proveedores
          </h2>
          {r.comparativa_nombre && (
            <p className="mt-0.5 text-sm text-slate-600">
              Planilla:{" "}
              {r.comparativa_url ? (
                <a href={r.comparativa_url} target="_blank" rel="noreferrer" className="underline">
                  {r.comparativa_nombre}
                </a>
              ) : (
                r.comparativa_nombre
              )}
            </p>
          )}
        </div>

        {puedeCargar && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelector(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {r.comparativa_drive_id ? "Cambiar planilla" : "Elegir comparativa de Drive"}
            </button>
            {r.comparativa_drive_id && (
              <button
                onClick={volverATraer}
                disabled={trayendo}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {trayendo ? "Trayendo…" : "Volver a traer"}
              </button>
            )}
            {!cargando && (
              <button
                onClick={() => setCargando(true)}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
              >
                Cargar presupuesto
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 p-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {aviso && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {aviso}
          </div>
        )}

        {cargando && (
          <PresupuestoForm
            requerimientoId={r.id}
            proveedores={proveedores}
            cantidadSugerida={r.cantidad}
            onListo={(a) => refrescar(a)}
            onCancelar={() => setCargando(false)}
          />
        )}

        {ordenadas.length === 0 ? (
          <p className="text-sm text-slate-400">Todavía no hay presupuestos cargados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Proveedor</th>
                  <th className="px-3 py-2 text-left">Marca</th>
                  <th className="px-3 py-2 text-right">Unitario</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-right">Envío</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Pago</th>
                  <th className="px-3 py-2 text-left">Disponibilidad</th>
                  <th className="px-3 py-2 text-left">Vale hasta</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ordenadas.map((c) => {
                  const vencido = c.precio_hasta !== null && c.precio_hasta < hoy;
                  return (
                    <tr key={c.id} className={c.elegida ? "bg-green-50" : ""}>
                      <td className={`px-3 py-2 ${c.elegida ? "font-semibold" : ""}`}>
                        {c.proveedores?.nombre ?? "—"}
                        {c.elegida && <span className="ml-1.5 text-xs text-green-700">✓ elegida</span>}
                        {!c.elegida && c.id === masBarato && (
                          <span className="ml-1.5 text-xs text-slate-400">más barato</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{c.marca ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{moneda(c.precio_unitario)}</td>
                      <td className="px-3 py-2 text-right">{c.cantidad ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{moneda(c.costo_envio)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {moneda(c.precio_total)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.plazo_pago_dias === null ? "—" : `${c.plazo_pago_dias} días`}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{c.disponibilidad ?? "—"}</td>
                      <td className={`px-3 py-2 ${vencido ? "text-red-600" : "text-slate-600"}`}>
                        {fecha(c.precio_hasta)}
                        {vencido && <span className="ml-1 text-xs">vencido</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {puedeElegir && (
                          <button
                            onClick={() => elegir(c)}
                            disabled={eligiendo !== null}
                            className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
                          >
                            {eligiendo === c.id ? "Aprobando…" : "Aprobar con este"}
                          </button>
                        )}
                        {!puedeElegir && puedeCargar && (
                          <button
                            onClick={() => borrar(c)}
                            className="text-xs text-slate-400 hover:text-red-600"
                          >
                            Borrar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {congelada && cotizaciones.length > 0 && (
          <p className="text-xs text-slate-400">
            La comparativa quedó congelada al aprobarse la compra.
          </p>
        )}
      </div>

      {selector && (
        <SelectorComparativa
          requerimientoId={r.id}
          onListo={(mensaje) => refrescar(mensaje)}
          onCerrar={() => setSelector(false)}
        />
      )}
    </section>
  );
}
