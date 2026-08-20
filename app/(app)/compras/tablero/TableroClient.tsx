"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  COLUMNAS_TABLERO, SIGUIENTE_ESTADO, COMPRA_LABELS,
  etiquetaPrioridad, pesoPrioridad, moneda, fecha, diasRestantes, etiquetaEmpresa,
} from "@/lib/compras/constants";
import type { RequerimientoConRelaciones, EstadoCompra } from "@/lib/compras/types";

export default function TableroClient({
  requerimientos,
  canEdit,
}: {
  requerimientos: RequerimientoConRelaciones[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [procesando, setProcesando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [area, setArea] = useState("");
  const [empresa, setEmpresa] = useState("");

  const areas = useMemo(
    () => [...new Set(requerimientos.map((r) => r.compras_areas?.nombre).filter(Boolean) as string[])].sort(),
    [requerimientos]
  );

  const filtrados = useMemo(() => {
    let base = requerimientos;
    if (area) base = base.filter((r) => r.compras_areas?.nombre === area);
    if (empresa) {
      base = base.filter((r) =>
        empresa === "AMBAS" ? r.empresa_id === null : r.empresas?.nombre === empresa
      );
    }
    return [...base].sort(
      (a, b) =>
        pesoPrioridad(a.prioridad) - pesoPrioridad(b.prioridad) ||
        new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
    );
  }, [requerimientos, area, empresa]);

  const comprometido = useMemo(
    () => filtrados.reduce((acc, r) => acc + (r.costo_iva ?? 0) + (r.costo_envio ?? 0), 0),
    [filtrados]
  );

  async function avanzar(r: RequerimientoConRelaciones) {
    const destino = SIGUIENTE_ESTADO[r.estado_compra];
    if (!destino) return;

    // Emitir un pedido sin proveedor definido no tiene sentido.
    if (destino === "PEDIDO" && !r.proveedor_id) {
      setError(`El RI ${r.nro_ri} necesita un proveedor antes de pasar a Pedido.`);
      return;
    }

    setProcesando(r.id);
    setError("");
    const res = await fetch(`/api/compras/requerimientos/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado_compra: destino }),
    });
    setProcesando(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo actualizar el estado.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Tablero de compras</h1>
        <p className="text-sm text-slate-500">
          {filtrados.length} requerimiento{filtrados.length === 1 ? "" : "s"} aprobados en curso
          {comprometido > 0 && <> · comprometido: <strong className="font-mono">{moneda(comprometido)}</strong></>}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          <option value="">Todas las áreas</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
        >
          <option value="">Cualquier empresa</option>
          <option value="POLCECAL">POLCECAL</option>
          <option value="POLYSAN">POLYSAN</option>
          <option value="AMBAS">Ambas</option>
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!canEdit && (
        <p className="text-sm text-slate-500">
          Estás viendo el tablero en modo consulta. Gestionar compras requiere nivel de edición.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNAS_TABLERO.map((columna) => {
          const items = filtrados.filter((r) => r.estado_compra === columna);
          const totalColumna = items.reduce((acc, r) => acc + (r.costo_iva ?? 0) + (r.costo_envio ?? 0), 0);
          const siguiente = SIGUIENTE_ESTADO[columna] as EstadoCompra | undefined;

          return (
            <section key={columna} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COMPRA_LABELS[columna].color}`}>
                  {COMPRA_LABELS[columna].label}
                </span>
                <span className="text-xs text-slate-500">
                  {items.length}{totalColumna > 0 && ` · ${moneda(totalColumna)}`}
                </span>
              </header>

              <div className="max-h-[70vh] space-y-2 overflow-y-auto p-3">
                {items.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">Nada en esta etapa.</p>
                ) : (
                  items.map((r) => {
                    const dias = diasRestantes(r.fecha_necesidad);
                    const vencido = dias !== null && dias < 0;
                    const donde = r.compras_ubicaciones?.nombre ?? r.ubicacion_raw;
                    return (
                      <article
                        key={r.id}
                        className={`rounded-lg border bg-white p-3 ${vencido ? "border-l-4 border-l-red-500 border-slate-200" : "border-slate-200"}`}
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/compras/requerimientos/${r.id}`}
                            className="font-mono text-xs font-semibold text-[var(--primary)] hover:underline"
                          >
                            RI {r.nro_ri}
                          </Link>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${etiquetaPrioridad(r.prioridad).color}`}>
                            {etiquetaPrioridad(r.prioridad).label}
                          </span>
                          <span className="text-[11px] text-slate-400">{etiquetaEmpresa(r.empresas?.nombre, r.paga_ambas)}</span>
                        </div>

                        <Link
                          href={`/compras/requerimientos/${r.id}`}
                          className="block text-sm leading-snug text-slate-900 hover:underline"
                        >
                          {r.descripcion}
                        </Link>

                        <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                          <div>{r.compras_areas?.nombre ?? "Sin área"}{donde ? ` · ${donde}` : ""}</div>
                          {r.proveedores?.nombre && <div>Proveedor: {r.proveedores.nombre}</div>}
                          {r.costo_iva !== null && <div className="font-mono">{moneda(r.costo_iva)}</div>}
                          <div className={vencido ? "font-semibold text-red-600" : ""}>
                            {r.fecha_necesidad
                              ? vencido
                                ? `Vencido hace ${Math.abs(dias!)} d`
                                : `Se necesita el ${fecha(r.fecha_necesidad)}`
                              : "Sin fecha límite"}
                          </div>
                        </div>

                        {canEdit && siguiente && (
                          <button
                            onClick={() => avanzar(r)}
                            disabled={procesando === r.id}
                            className="mt-2.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {procesando === r.id ? "Actualizando…" : `Pasar a ${COMPRA_LABELS[siguiente].label} →`}
                          </button>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
