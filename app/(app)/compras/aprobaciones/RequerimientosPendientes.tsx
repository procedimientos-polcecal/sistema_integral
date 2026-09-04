"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  etiquetaPrioridad, pesoPrioridad, fecha, diasRestantes, etiquetaEmpresa,
} from "@/lib/compras/constants";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

/**
 * Los requerimientos que esperan decisión.
 *
 * Salió de `AprobacionesClient` cuando la pantalla pasó a mostrar también las
 * órdenes de servicio: son dos colas que no se parecen —una pide materiales y
 * la otra trabajo— y mezclarlas en un archivo dejaba dos tablas, dos
 * selecciones y dos manejos de error compartiendo el mismo estado.
 */
export default function RequerimientosPendientes({
  pendientes,
  puedeAprobar,
}: {
  pendientes: RequerimientoConRelaciones[];
  puedeAprobar: boolean;
}) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  const [area, setArea] = useState("");

  const areas = useMemo(
    () => [...new Set(pendientes.map((r) => r.compras_areas?.nombre).filter(Boolean) as string[])].sort(),
    [pendientes]
  );

  // Lo más urgente arriba; a igual prioridad, lo que lleva más tiempo esperando.
  const filas = useMemo(() => {
    const base = area ? pendientes.filter((r) => r.compras_areas?.nombre === area) : pendientes;
    return [...base].sort(
      (a, b) =>
        pesoPrioridad(a.prioridad) - pesoPrioridad(b.prioridad) ||
        new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
    );
  }, [pendientes, area]);

  const todoSeleccionado = filas.length > 0 && filas.every((f) => seleccion.has(f.id));

  function alternar(id: string) {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  /** Aprobación en tanda, como se hacía en la hoja "APROB MAXI". */
  async function aprobarSeleccion() {
    if (seleccion.size === 0) return;
    setProcesando(true);
    setError("");

    const ids = [...seleccion];
    let fallidos = 0;

    for (const id of ids) {
      const res = await fetch(`/api/compras/requerimientos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado_aprobacion: "APROBADA" }),
      });
      if (!res.ok) fallidos++;
    }

    setProcesando(false);
    setSeleccion(new Set());
    if (fallidos > 0) setError(`No se pudieron aprobar ${fallidos} de ${ids.length} requerimientos.`);
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Requerimientos</h2>
        <p className="text-sm text-slate-500">
          {pendientes.length === 0
            ? "Nada esperando decisión."
            : `${pendientes.length} esperando decisión`}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {pendientes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-400">
          Todo al día. No queda ningún requerimiento pendiente de aprobación.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="">Todas las áreas</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>

            {puedeAprobar && seleccion.size > 0 && (
              <button
                onClick={aprobarSeleccion}
                disabled={procesando}
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
              >
                {procesando ? "Aprobando…" : `Aprobar ${seleccion.size} seleccionado${seleccion.size === 1 ? "" : "s"}`}
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {puedeAprobar && (
                      <th className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={todoSeleccionado}
                          onChange={() => setSeleccion(todoSeleccionado ? new Set() : new Set(filas.map((f) => f.id)))}
                          aria-label="Seleccionar todo"
                        />
                      </th>
                    )}
                    <th className="px-3 py-2 text-left">N° RI</th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Descripción</th>
                    <th className="px-3 py-2 text-left">Área</th>
                    <th className="px-3 py-2 text-left">Dónde</th>
                    <th className="px-3 py-2 text-right">Cant.</th>
                    <th className="px-3 py-2 text-left">Prioridad</th>
                    <th className="px-3 py-2 text-left">Paga</th>
                    <th className="px-3 py-2 text-left">Se necesita</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filas.map((f) => {
                    const dias = diasRestantes(f.fecha_necesidad);
                    const vencido = dias !== null && dias < 0;
                    const donde = f.compras_ubicaciones?.nombre ?? f.ubicacion_raw;
                    return (
                      <tr key={f.id} className="hover:bg-slate-50">
                        {puedeAprobar && (
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={seleccion.has(f.id)}
                              onChange={() => alternar(f.id)}
                              aria-label={`Seleccionar RI ${f.nro_ri}`}
                            />
                          </td>
                        )}
                        <td className="px-3 py-2 font-mono">
                          <Link href={`/compras/requerimientos/${f.id}`} className="font-semibold text-[var(--primary)] hover:underline">
                            {f.nro_ri}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(f.fecha)}</td>
                        <td className="max-w-sm px-3 py-2">
                          <Link href={`/compras/requerimientos/${f.id}`} className="text-slate-900 hover:underline">
                            {f.descripcion}
                          </Link>
                          {f.detalle_extra && (
                            <div className="line-clamp-2 text-xs text-slate-400">{f.detalle_extra}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{f.compras_areas?.nombre ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{donde ?? "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{f.cantidad ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${etiquetaPrioridad(f.prioridad).color}`}>
                            {etiquetaPrioridad(f.prioridad).label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{etiquetaEmpresa(f.empresas?.nombre, f.paga_ambas)}</td>
                        <td className={`whitespace-nowrap px-3 py-2 ${vencido ? "font-semibold text-red-600" : "text-slate-600"}`}>
                          {f.fecha_necesidad ? fecha(f.fecha_necesidad) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Link href={`/compras/requerimientos/${f.id}`} className="text-xs text-slate-500 hover:text-slate-900">
                            Revisar →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {!puedeAprobar && (
            <p className="text-sm text-slate-500">
              Podés consultar la cola, pero no aprobar. Aprobar un requerimiento requiere estar
              en la lista de aprobadores de Compras.
            </p>
          )}
        </>
      )}
    </section>
  );
}
