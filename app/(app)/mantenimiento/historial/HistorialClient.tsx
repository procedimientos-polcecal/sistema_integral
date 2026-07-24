"use client";

import { useState, useMemo } from "react";
import InfoTip from "@/components/InfoTip";

const STATUS_COLORS: Record<string, string> = {
  completado: "bg-green-100 text-green-800",
  parcial:    "bg-yellow-100 text-yellow-800",
  cancelado:  "bg-red-100 text-red-800",
};

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "—";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim() || "—";
}

export default function HistorialClient({ executions }: { executions: any[] }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return executions.filter((e) => {
      if (filterStatus && e.execution_status !== filterStatus) return false;
      if (filterType && e.schedule?.maintenance_type !== filterType) return false;
      if (q) {
        const code = e.schedule?.equipos?.code?.toLowerCase() ?? "";
        const name = e.schedule?.equipos?.name?.toLowerCase() ?? "";
        const obs  = e.observations?.toLowerCase() ?? "";
        if (!code.includes(q) && !name.includes(q) && !obs.includes(q)) return false;
      }
      return true;
    });
  }, [executions, search, filterStatus, filterType]);

  function exportCSV() {
    const rows = [
      ["Fecha", "Código", "Equipo", "Empresa", "Sector", "Tipo", "Estado", "Duración (h)", "Ejecutado por", "Observaciones"],
      ...filtered.map((e) => [
        new Date(e.executed_at).toLocaleDateString("es-AR"),
        e.schedule?.equipos?.code ?? "",
        e.schedule?.equipos?.name ?? "",
        e.schedule?.equipos?.sectores?.empresas?.nombre ?? "",
        e.schedule?.equipos?.sectores?.nombre ?? "",
        e.schedule?.maintenance_type ?? "",
        e.execution_status,
        e.duration_hours ?? "",
        nombreCompleto(e.executor),
        (e.observations ?? "").replace(/"/g, '""'),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historial-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const types = [...new Set(executions.map((e) => e.schedule?.maintenance_type).filter(Boolean))];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Historial
            <InfoTip text="Registro completo de todos los mantenimientos ya ejecutados, con fecha, responsable, estado y observaciones. Podés filtrarlo y exportarlo a CSV para informes." />
          </h1>
          <p className="text-sm text-gray-500">{filtered.length} registros</p>
        </div>
        <button
          onClick={exportCSV}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <input
          type="text"
          placeholder="Buscar equipo, código, observación..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2 md:col-span-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none">
          <option value="">Todos los estados</option>
          <option value="completado">Completado</option>
          <option value="parcial">Parcial</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none">
          <option value="">Todos los tipos</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Fecha</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Equipo</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Tipo</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Duración</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Ejecutado por</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Observaciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((e: any) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                  {new Date(e.executed_at).toLocaleDateString("es-AR")}
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-900">{e.schedule?.equipos?.code}</span>
                  <span className="text-gray-500 ml-1">{e.schedule?.equipos?.name}</span>
                </td>
                <td className="px-4 py-3 text-gray-500">{e.schedule?.maintenance_type}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[e.execution_status] ?? ""}`}>
                    {e.execution_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{e.duration_hours ? `${e.duration_hours} h` : "—"}</td>
                <td className="px-4 py-3 text-gray-500">{nombreCompleto(e.executor)}</td>
                <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{e.observations ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">Sin resultados.</div>
        )}
      </div>

      <div className="md:hidden space-y-2">
        {filtered.map((e: any) => (
          <div key={e.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-900 text-sm">{e.schedule?.equipos?.code} — {e.schedule?.equipos?.name}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${STATUS_COLORS[e.execution_status] ?? ""}`}>
                {e.execution_status}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {new Date(e.executed_at).toLocaleDateString("es-AR")} · {e.schedule?.maintenance_type}
              {e.duration_hours ? ` · ${e.duration_hours} h` : ""}
            </p>
            {e.observations && <p className="text-xs text-gray-400 line-clamp-2">{e.observations}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
