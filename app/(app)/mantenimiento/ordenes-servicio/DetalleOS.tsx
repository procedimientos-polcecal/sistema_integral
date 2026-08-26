"use client";

import { useCallback, useEffect, useState } from "react";
import { fecha, monedaExacta } from "@/lib/compras/constants";
import { monto } from "@/lib/mantenimiento/planilla";
import { resumenDeCotizaciones } from "@/lib/mantenimiento/comparativas";
import { ESTADOS_OS } from "@/lib/mantenimiento/os";
import type { OrdenServicio, CotizacionOS } from "@/lib/mantenimiento/types";
import CotizacionForm from "./CotizacionForm";

/**
 * Una orden de servicio abierta: cómo viene y qué se cotizó.
 *
 * Dos cosas en la misma pantalla porque se miran juntas: elegir el proveedor
 * es lo que decide el seguimiento.
 */
export default function DetalleOS({
  orden, puedeEditar, onCerrar, onCambio,
}: {
  orden: OrdenServicio;
  puedeEditar: boolean;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [cotizaciones, setCotizaciones] = useState<CotizacionOS[] | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cargandoComparativa, setCargandoComparativa] = useState(true);
  const [cargandoNueva, setCargandoNueva] = useState(false);

  const [estado, setEstado] = useState(orden.estado ?? "");
  const [proveedor, setProveedor] = useState(orden.proveedor_elegido ?? "");
  const [fechaPedido, setFechaPedido] = useState(orden.fecha_pedido ?? "");
  const [fechaRealizacion, setFechaRealizacion] = useState(orden.fecha_realizacion ?? "");
  const [observaciones, setObservaciones] = useState(orden.observaciones ?? "");

  const traerComparativa = useCallback(async () => {
    if (!orden.os_number) { setCargandoComparativa(false); return; }
    setCargandoComparativa(true);

    const res = await fetch(`/api/mantenimiento/comparativas?os=${orden.os_number}`);
    const body = await res.json().catch(() => ({}));
    setCargandoComparativa(false);

    if (!res.ok) { setError(body.error ?? "No se pudo traer la comparativa."); return; }
    setCotizaciones(body.data ?? []);
  }, [orden.os_number]);

  useEffect(() => { traerComparativa(); }, [traerComparativa]);

  async function guardarSeguimiento() {
    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/ordenes-servicio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: orden.id,
        estado, proveedor_elegido: proveedor,
        fecha_pedido: fechaPedido || null,
        fecha_realizacion: fechaRealizacion || null,
        observaciones,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo guardar."); return; }
    // La app ya guardó; la planilla es best-effort y su problema se muestra.
    if (body.planilla_error) setError(`Guardado, pero no se pudo escribir en la planilla: ${body.planilla_error}`);
    onCambio();
  }

  /** Elegir una cotización es también anotar quién hace el trabajo. */
  async function elegir(cot: CotizacionOS) {
    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/comparativas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: cot.id, eleccion: !cot.eleccion }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo elegir."); return; }
    if (!cot.eleccion) setProveedor(cot.proveedor);
    traerComparativa();
    onCambio();
  }

  /** Sacar una cotización: se vacía su fila en la planilla y se borra acá. */
  async function borrar(cot: CotizacionOS) {
    setGuardando(true);
    setError("");

    const res = await fetch(`/api/mantenimiento/comparativas?id=${cot.id}`, { method: "DELETE" });
    setGuardando(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo borrar.");
      return;
    }
    traerComparativa();
    onCambio();
  }

  const resumen = resumenDeCotizaciones(cotizaciones ?? []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-3xl space-y-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              OS #{orden.os_number ?? "—"}
              {orden.prioridad && (
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {orden.prioridad}
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {fecha(orden.fecha)} · {orden.area ?? "sin área"} ·{" "}
              {orden.sectores?.nombre ?? orden.sector_raw ?? "sin sector"}
            </p>
          </div>
          <button onClick={onCerrar} className="text-xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-800">{orden.descripcion ?? "—"}</p>
          {orden.detalle_extra && <p className="mt-1 text-xs text-slate-500">{orden.detalle_extra}</p>}
          {orden.equipo_raw && (
            <p className="mt-1 text-xs text-slate-400">
              Equipo: {orden.equipos?.name ?? orden.equipo_raw}
              {!orden.equipment_id && " · sin enlazar al sistema"}
            </p>
          )}
        </div>

        {/* Seguimiento */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Cómo viene</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Estado">
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                disabled={!puedeEditar}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              >
                <option value="">Sin estado</option>
                {/* Los de la planilla. Si trae uno que no está en la lista se
                    suma, para no perderlo al guardar. */}
                {[...new Set([...ESTADOS_OS, ...(estado ? [estado] : [])])].map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Proveedor">
              <input
                value={proveedor}
                onChange={(e) => setProveedor(e.target.value)}
                disabled={!puedeEditar}
                placeholder="—"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </Campo>
            <Campo etiqueta="Cuándo se pidió">
              <input
                type="date"
                value={fechaPedido?.slice(0, 10) ?? ""}
                onChange={(e) => setFechaPedido(e.target.value)}
                disabled={!puedeEditar}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </Campo>
            <Campo etiqueta="Cuándo se hizo">
              <input
                type="date"
                value={fechaRealizacion?.slice(0, 10) ?? ""}
                onChange={(e) => setFechaRealizacion(e.target.value)}
                disabled={!puedeEditar}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </Campo>
          </div>

          <Campo etiqueta="Observaciones">
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              disabled={!puedeEditar}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </Campo>

          {puedeEditar && (
            <button
              onClick={guardarSeguimiento}
              disabled={guardando}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          )}
        </div>

        {/* Comparativa */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-800">
              Comparativa
              {/* La planilla guarda el link detrás de la palabra "LINK". */}
              {orden.comparativa?.startsWith("http") && (
                <a
                  href={orden.comparativa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-xs font-normal text-blue-600 hover:underline"
                >ver la planilla</a>
              )}
            </h3>
            <div className="flex items-center gap-3">
              {resumen.cantidad > 0 && resumen.seEligioLaMasBarata === false && (
                <span className="text-xs text-amber-700">
                  La elegida está {monedaExacta(resumen.diferencia)} por encima de la más barata.
                </span>
              )}
              {puedeEditar && !cargandoNueva && orden.os_number && (
                <button
                  onClick={() => setCargandoNueva(true)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cargar cotización
                </button>
              )}
            </div>
          </div>

          {cargandoNueva && orden.os_number && (
            <CotizacionForm
              osNumber={orden.os_number}
              sector={orden.sector_raw ?? orden.sectores?.nombre ?? null}
              onCerrar={() => setCargandoNueva(false)}
              onCargada={() => { setCargandoNueva(false); traerComparativa(); onCambio(); }}
            />
          )}

          {cargandoComparativa ? (
            <p className="py-6 text-center text-sm text-slate-400">Trayendo las cotizaciones…</p>
          ) : (cotizaciones ?? []).length === 0 ? (
            <p className="rounded-xl border border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
              Esta OS no tiene cotizaciones cargadas en la planilla de comparativas.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Proveedor</th>
                    <th className="px-3 py-2 text-right">Unitario</th>
                    <th className="px-3 py-2 text-right">IVA</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-left">Plazo</th>
                    <th className="px-3 py-2 text-left">Pago</th>
                    <th className="px-3 py-2 text-left">Vigencia</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(cotizaciones ?? []).map((c) => {
                    const esLaMasBarata = resumen.masBarata?.id === c.id;
                    return (
                      <tr key={c.id} className={c.eleccion ? "bg-emerald-50/60" : ""}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{c.proveedor}</div>
                          {c.otras_especificaciones && (
                            <div className="text-xs text-slate-400">{c.otras_especificaciones}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {monedaExacta(monto(c.precio_unitario))}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {c.iva === null ? "—" : `${Math.round(c.iva * 100)}%`}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-800">
                          {monedaExacta(monto(c.precio_total))}
                          {esLaMasBarata && (
                            <div className="text-[10px] font-normal text-emerald-700">la más barata</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{c.plazos ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{c.condiciones_pago ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{fecha(c.vigencia_hasta)}</td>
                        <td className="px-3 py-2 text-right">
                          {puedeEditar ? (
                            <button
                              onClick={() => elegir(c)}
                              disabled={guardando}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                                c.eleccion
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                  : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {c.eleccion ? "Elegida" : "Elegir"}
                            </button>
                          ) : (
                            c.eleccion && <span className="text-xs font-semibold text-emerald-700">Elegida</span>
                          )}
                          {puedeEditar && (
                            <button
                              onClick={() => borrar(c)}
                              disabled={guardando}
                              className="ml-1.5 text-xs text-slate-400 hover:text-red-600 disabled:opacity-50"
                              title="Sacar esta cotización de la comparativa"
                            >×</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-slate-600">{etiqueta}</span>
      {children}
    </label>
  );
}
