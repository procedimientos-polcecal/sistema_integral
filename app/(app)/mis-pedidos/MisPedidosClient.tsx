"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import NuevoRequerimientoModal from "@/app/(app)/compras/requerimientos/NuevoRequerimientoModal";
import {
  APROBACION_LABELS, COMPRA_LABELS, PRIORIDAD_LABELS, fecha, moneda,
} from "@/lib/compras/constants";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

type Opcion = { id: string; nombre: string };

export default function MisPedidosClient({
  pedidos, areas, empresas, sectores, equipos,
}: {
  pedidos: RequerimientoConRelaciones[];
  areas: Opcion[];
  empresas: Opcion[];
  sectores: Opcion[];
  equipos: { id: string; name: string; code: string }[];
}) {
  const router = useRouter();
  const [modalAbierto, setModalAbierto] = useState(false);

  const abiertos = pedidos.filter(
    (p) => p.estado_aprobacion !== "DENEGADA" && p.estado_compra !== "RECIBIDO"
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mis pedidos</h1>
          <p className="text-sm text-slate-500">
            {pedidos.length === 0
              ? "Todavía no pediste nada."
              : `${pedidos.length} pedido${pedidos.length === 1 ? "" : "s"}, ${abiertos} sin cerrar`}
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          + Pedir un material
        </button>
      </div>

      {pedidos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
          <p className="text-sm text-slate-500">
            Acá vas a ver el estado de todo lo que pidas: si ya se aprobó, a qué proveedor
            se le compró y cuándo llegó.
          </p>
          <button
            onClick={() => setModalAbierto(true)}
            className="mt-4 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            Cargar mi primer pedido
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">N° RI</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Qué pedí</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-left">Prioridad</th>
                  <th className="px-3 py-2 text-left">Aprobación</th>
                  <th className="px-3 py-2 text-left">Compra</th>
                  <th className="px-3 py-2 text-left">Proveedor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pedidos.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-slate-500">{p.nro_ri}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(p.fecha)}</td>
                    <td className="max-w-sm px-3 py-2 text-slate-900">
                      {p.descripcion}
                      {p.motivo_rechazo && (
                        <div className="text-xs text-red-600">Rechazado: {p.motivo_rechazo}</div>
                      )}
                      {p.estado_compra === "RECIBIDO" && p.fecha_recepcion && (
                        <div className="text-xs text-green-700">Recibido el {fecha(p.fecha_recepcion)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{p.cantidad ?? "—"}</td>
                    <td className="px-3 py-2"><Chip {...PRIORIDAD_LABELS[p.prioridad]} /></td>
                    <td className="px-3 py-2"><Chip {...APROBACION_LABELS[p.estado_aprobacion]} /></td>
                    <td className="px-3 py-2"><Chip {...COMPRA_LABELS[p.estado_compra]} /></td>
                    <td className="px-3 py-2 text-slate-600">{p.proveedores?.nombre ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalAbierto && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          sectores={sectores}
          equipos={equipos}
          onClose={() => setModalAbierto(false)}
          onSaved={() => { setModalAbierto(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}
