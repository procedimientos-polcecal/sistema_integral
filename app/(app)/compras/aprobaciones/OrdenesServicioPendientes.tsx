"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fecha } from "@/lib/compras/constants";
import { justificacionQueExplica } from "@/lib/core/justificacion";
import { ordenarParaAprobar } from "@/lib/mantenimiento/aprobacion";
import type { OrdenServicio } from "@/lib/mantenimiento/types";

/**
 * Las órdenes de servicio que esperan decisión.
 *
 * Una OS es un trabajo que se le pide a un tercero, a diferencia de la orden de
 * trabajo que hace el personal propio. Nacen en un formulario de Google y viven
 * en una planilla; acá se decide si se hacen, que es el paso que las manda a
 * comparativa.
 *
 * **No se aprueba en tanda.** Los requerimientos sí —así se hacía en la hoja
 * "APROB MAXI"— pero cada aprobación de OS sale a leer y escribir la planilla,
 * y una que se niegue en el medio de veinte dejaría a quien apretó sin saber
 * cuál fue. Son once: de a una se pueden.
 */
export default function OrdenesServicioPendientes({
  pendientes,
  puedeAprobar,
}: {
  pendientes: OrdenServicio[];
  puedeAprobar: boolean;
}) {
  const router = useRouter();
  const [procesando, setProcesando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [denegando, setDenegando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [area, setArea] = useState("");

  const areas = useMemo(
    () => [...new Set(pendientes.map((o) => o.area).filter(Boolean) as string[])].sort(),
    [pendientes]
  );

  const filas = useMemo(() => {
    const base = area ? pendientes.filter((o) => o.area === area) : pendientes;
    return ordenarParaAprobar(
      base.map((o) => ({ ...o, os_number: o.os_number ?? 0 }))
    );
  }, [pendientes, area]);

  // La misma regla que el servidor, para no mandar un pedido que ya sabemos que
  // va a volver. El servidor la exige igual: una validación que sólo vive en el
  // botón deja de existir apenas alguien llame a la API de otra forma.
  const faltaElMotivo = !justificacionQueExplica(motivo);

  async function decidir(id: string, estado: string, motivo_rechazo?: string) {
    setProcesando(id);
    setError("");

    const res = await fetch("/api/mantenimiento/ordenes-servicio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, estado, ...(motivo_rechazo ? { motivo_rechazo } : {}) }),
    });
    const body = await res.json().catch(() => ({}));

    setProcesando(null);

    if (!res.ok) {
      // Sin traducir y entero. Cuando el sistema se niega a aprobar es porque
      // la fila entraría en el medio de la pestaña, y ese texto dice qué hacer:
      // resumirlo a "no se pudo" deja a quien aprueba sin salida.
      setError(body.error ?? "No se pudo guardar la decisión.");
      return;
    }

    // Que la app haya guardado no significa que la planilla se haya enterado.
    if (body.planilla_error) setError(body.planilla_error);

    setDenegando(null);
    setMotivo("");
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Órdenes de servicio</h2>
        <p className="text-sm text-slate-500">
          {pendientes.length === 0
            ? "Nada esperando decisión."
            : `${pendientes.length} esperando decisión`}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {pendientes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-400">
          Todo al día. No queda ninguna orden de servicio pendiente de aprobación.
        </div>
      ) : (
        <>
          {areas.length > 1 && (
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="">Todas las áreas</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">N° OS</th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Descripción</th>
                    <th className="px-3 py-2 text-left">Área</th>
                    <th className="px-3 py-2 text-left">Sector</th>
                    <th className="px-3 py-2 text-left">Equipo</th>
                    <th className="px-3 py-2 text-left">Prioridad</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filas.map((o) => (
                    <tr key={o.id} className="align-top hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                        {o.os_number || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {o.fecha ? fecha(o.fecha) : "—"}
                      </td>
                      <td className="max-w-sm px-3 py-2">
                        <div className="text-slate-900">{o.descripcion ?? "—"}</div>
                        {o.detalle_extra && (
                          <div className="line-clamp-2 text-xs text-slate-400">{o.detalle_extra}</div>
                        )}
                        {o.imagen && (
                          <a
                            href={o.imagen}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--primary)] hover:underline"
                          >
                            Ver imagen
                          </a>
                        )}

                        {denegando === o.id && (
                          <div className="mt-2 space-y-2">
                            {/* El motivo no va a la planilla: su única columna de
                                texto libre es OBSERVACIONES, de uso general. */}
                            <textarea
                              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                              rows={2}
                              placeholder="Por qué se deniega"
                              value={motivo}
                              onChange={(e) => setMotivo(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => decidir(o.id, "DENEGADO", motivo)}
                                disabled={faltaElMotivo || procesando === o.id}
                                className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                Confirmar denegación
                              </button>
                              <button
                                onClick={() => { setDenegando(null); setMotivo(""); }}
                                className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              >
                                Cancelar
                              </button>
                            </div>
                            {faltaElMotivo && (
                              <p className="text-xs text-slate-500">
                                Quien la pidió necesita saber si lo hace el taller propio, si no
                                había presupuesto o si se resolvió de otra forma. Un guión o un
                                «no» no alcanzan.
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{o.area ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {o.sectores?.nombre ?? o.sector_raw ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {o.equipos?.name ?? o.equipo_raw ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{o.prioridad ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {puedeAprobar && denegando !== o.id && (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => decidir(o.id, "APROBADO")}
                              disabled={procesando === o.id}
                              className="rounded-lg bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
                            >
                              {procesando === o.id ? "…" : "Aprobar"}
                            </button>
                            <button
                              onClick={() => decidir(o.id, "EN REVISIÓN")}
                              disabled={procesando === o.id}
                              className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            >
                              En revisión
                            </button>
                            <button
                              onClick={() => { setDenegando(o.id); setMotivo(""); }}
                              disabled={procesando === o.id}
                              className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              Denegar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!puedeAprobar && (
            <p className="text-sm text-slate-500">
              Podés consultar la cola, pero no decidir. Aprobar o denegar una orden de servicio
              requiere estar en la lista de aprobadores de OS.
            </p>
          )}
        </>
      )}
    </section>
  );
}
