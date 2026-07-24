"use client";

import { useEffect, useState, useCallback } from "react";
import NuevaOTModal from "./NuevaOTModal";
import { useConfirm } from "@/components/ConfirmProvider";
import InfoTip from "@/components/InfoTip";

const ESTADOS = [
  { value: "",           label: "Todos",      color: "#64748B", bg: "#F8FAFC", dot: "#94A3B8" },
  { value: "ATRASADO",   label: "Atrasado",   color: "#DC2626", bg: "#FEF2F2", dot: "#EF4444" },
  { value: "EN_PROCESO", label: "En proceso", color: "#1D4ED8", bg: "#EFF6FF", dot: "#3B82F6" },
  { value: "POR_HACER",  label: "Por hacer",  color: "#B45309", bg: "#FFFBEB", dot: "#F59E0B" },
  { value: "REALIZADO",  label: "Realizado",  color: "#16A34A", bg: "#F0FDF4", dot: "#22C55E" },
];

export function estadoMeta(v: string) {
  return ESTADOS.find((e) => e.value === v) ?? { label: v, color: "#64748B", bg: "#F8FAFC", dot: "#94A3B8" };
}

export default function OrdenesClient({
  canEdit, sectores, equipos,
}: {
  canEdit: boolean;
  sectores: any[];
  equipos: any[];
}) {
  const confirm = useConfirm();
  const [orders, setOrders]     = useState<any[]>([]);
  const [count, setCount]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [estadoFilter, setEstadoFilter] = useState("");
  const [search, setSearch]     = useState("");
  const [page, setPage]         = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNew, setShowNew]   = useState(false);
  const [view, setView]         = useState<"list" | "kanban">("list");

  const [kanbanData, setKanbanData] = useState<Record<string, { items: any[]; count: number }>>({});
  const [kanbanLoading, setKanbanLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (estadoFilter) params.set("estado", estadoFilter);
    if (search)       params.set("q", search);
    const res = await fetch(`/api/mantenimiento/ordenes?${params}`);
    const json = await res.json();
    setOrders(json.data ?? []);
    setCount(json.count ?? 0);
    setLoading(false);
  }, [page, estadoFilter, search]);

  const KANBAN_ESTADOS = ["ATRASADO", "EN_PROCESO", "POR_HACER", "REALIZADO"];
  const loadKanban = useCallback(async () => {
    setKanbanLoading(true);
    const results = await Promise.all(
      KANBAN_ESTADOS.map((e) =>
        fetch(`/api/mantenimiento/ordenes?estado=${e}&page=1`).then((r) => r.json())
      )
    );
    const data: Record<string, { items: any[]; count: number }> = {};
    KANBAN_ESTADOS.forEach((e, i) => {
      data[e] = { items: results[i].data ?? [], count: results[i].count ?? 0 };
    });
    setKanbanData(data);
    setKanbanLoading(false);
  }, []);

  useEffect(() => {
    if (view === "kanban") loadKanban();
    else load();
  }, [view, load, loadKanban]);

  async function changeEstado(id: string, estado: string) {
    const meta = estadoMeta(estado);
    const ok = await confirm({
      title: "Cambiar estado de la OT",
      message: `La orden pasará al estado "${meta.label}". ¿Confirmás?`,
      confirmText: "Cambiar estado",
    });
    if (!ok) return;
    await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, estado }),
    });
    if (view === "kanban") loadKanban();
    else load();
  }

  const totalPages = Math.ceil(count / 50);

  const kanbanGroups = ESTADOS.slice(1).map(e => ({
    ...e,
    items: kanbanData[e.value]?.items ?? [],
    count: kanbanData[e.value]?.count ?? 0,
  }));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Órdenes de Trabajo
            <InfoTip text="Listado de todas las órdenes de trabajo (OT). Podés verlas como lista o como tablero Kanban por estado, filtrarlas, crear nuevas y cambiar su estado (Por hacer, En proceso, Atrasado, Realizado)." />
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nueva OT
            </button>
          )}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setView("list")}
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === "list" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
              Lista
            </button>
            <button onClick={() => setView("kanban")}
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === "kanban" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
              Kanban
            </button>
          </div>
        </div>
      </div>

      {view === "list" && (
        <div className="flex gap-2 flex-wrap">
          {ESTADOS.map((e) => (
            <button key={e.value} onClick={() => { setEstadoFilter(e.value); setPage(1); }}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all"
              style={{
                color:       estadoFilter === e.value ? e.color   : "#64748B",
                background:  estadoFilter === e.value ? e.bg      : "#fff",
                borderColor: estadoFilter === e.value ? e.color   : "#E2E8F0",
              }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: estadoFilter === e.value ? e.dot : "#CBD5E1" }} />
              {e.label}
            </button>
          ))}
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar equipo, sector, descripción..."
            className="w-full sm:w-60 sm:ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
        </div>
      )}

      {view === "kanban" ? (
        kanbanLoading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Cargando...</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {kanbanGroups.map((col) => (
              <div key={col.value}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full" style={{ background: col.dot }} />
                  <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{col.label}</span>
                  <span className="ml-auto text-xs font-mono text-gray-400">{col.count}</span>
                </div>
                <div className="space-y-2">
                  {col.count === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">
                      Sin órdenes
                    </div>
                  )}
                  {col.items.map((o) => (
                    <KanbanCard key={o.id} order={o} canEdit={canEdit} onChangeEstado={changeEstado} />
                  ))}
                  {col.count > col.items.length && (
                    <div className="text-center text-xs text-gray-400 py-1">
                      +{col.count - col.items.length} más — usá la vista Lista para ver todas
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Cargando...</div>
      ) : (
        <>
          <p className="text-xs text-gray-400">{count} órdenes</p>
          {orders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
              <p className="text-gray-400 text-sm">
                {canEdit ? "No hay órdenes con esos filtros. Creá la primera con \"Nueva OT\"." : "No hay órdenes con esos filtros."}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
              {orders.map((o) => {
                const meta   = estadoMeta(o.estado);
                const isOpen = expanded === o.id;
                return (
                  <div key={o.id}>
                    <button onClick={() => setExpanded(isOpen ? null : o.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors">
                      <span className="text-xs font-mono font-bold text-gray-400 w-12 shrink-0">#{o.ot_number}</span>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.dot }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{o.descripcion ?? "—"}</p>
                        <p className="text-xs text-gray-400 truncate">{o.sector_raw}{o.equipo_raw ? ` · ${o.equipo_raw}` : ""}</p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full border hidden sm:inline-flex items-center gap-1"
                        style={{ color: meta.color, background: meta.bg, borderColor: meta.color + "33" }}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0 hidden md:block">
                        {o.fecha ? new Date(o.fecha).toLocaleDateString("es-AR") : "—"}
                      </span>
                      <svg className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isOpen && <OTDetail order={o} canEdit={canEdit} onChangeEstado={changeEstado} />}
                  </div>
                );
              })}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">← Anterior</button>
              <span className="text-sm text-gray-500">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">Siguiente →</button>
            </div>
          )}
        </>
      )}

      {showNew && (
        <NuevaOTModal
          sectores={sectores}
          equipos={equipos}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}

function OTDetail({ order: o, canEdit, onChangeEstado }: {
  order: any; canEdit: boolean; onChangeEstado: (id: string, estado: string) => void;
}) {
  const ESTADO_OPTIONS = ["POR_HACER", "EN_PROCESO", "REALIZADO", "ATRASADO"];
  return (
    <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
        <D label="Especialidad"    value={o.especialidad} />
        <D label="Tipo"            value={o.tipo} />
        <D label="Quién realiza"   value={o.quien} />
        <D label="Contratista"     value={o.contratista} />
        <D label="Horas"           value={o.horas != null ? `${o.horas}h` : null} />
        <D label="Prioridad"       value={o.prioridad} />
        <D label="Operarios"       value={[o.operario_1, o.operario_2, o.operario_3].filter(Boolean).join(", ") || null} />
        <D label="Repuesto"        value={o.repuesto} />
        <D label="Fecha ejecución" value={o.fecha_ejecucion ? new Date(o.fecha_ejecucion).toLocaleDateString("es-AR") : null} />
        <D label="Fecha cierre"    value={o.fecha_cierre   ? new Date(o.fecha_cierre).toLocaleDateString("es-AR")   : null} />
        {o.app_created && <D label="Origen" value="Creada desde la app" />}
      </div>
      {o.descripcion && (
        <div>
          <p className="text-xs text-gray-500 font-medium mb-0.5">Descripción</p>
          <p className="text-sm text-gray-800">{o.descripcion}</p>
        </div>
      )}
      {canEdit && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <span className="text-xs text-gray-500 font-medium">Cambiar estado:</span>
          {ESTADO_OPTIONS.map((e) => {
            const m = estadoMeta(e);
            return (
              <button key={e} onClick={() => onChangeEstado(o.id, e)}
                disabled={o.estado === e}
                className="text-xs font-semibold px-2.5 py-1 rounded-full border transition-all disabled:opacity-40"
                style={{ color: m.color, background: m.bg, borderColor: m.color + "44" }}>
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KanbanCard({ order: o, canEdit, onChangeEstado }: {
  order: any; canEdit: boolean; onChangeEstado: (id: string, estado: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const NEXT: Record<string, string[]> = {
    POR_HACER:  ["EN_PROCESO", "ATRASADO"],
    EN_PROCESO: ["REALIZADO", "ATRASADO"],
    ATRASADO:   ["EN_PROCESO", "REALIZADO"],
    REALIZADO:  ["EN_PROCESO"],
  };
  const nextOptions = NEXT[o.estado] ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm space-y-2 relative">
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-mono text-gray-400">#{o.ot_number}</span>
        {canEdit && nextOptions.length > 0 && (
          <div className="relative">
            <button onClick={() => setMenu(m => !m)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
            </button>
            {menu && (
              <div className="absolute right-0 top-6 z-10 bg-white rounded-xl border border-gray-200 shadow-lg py-1 min-w-[130px]">
                {nextOptions.map(e => {
                  const m = estadoMeta(e);
                  return (
                    <button key={e} onClick={() => { onChangeEstado(o.id, e); setMenu(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-50 flex items-center gap-2"
                      style={{ color: m.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <p className="text-xs font-medium text-gray-800 leading-snug line-clamp-3">{o.descripcion ?? "—"}</p>
      <p className="text-xs text-gray-400 truncate">{o.equipo_raw ?? o.sector_raw ?? "—"}</p>
      {o.fecha && <p className="text-xs text-gray-300">{new Date(o.fecha).toLocaleDateString("es-AR")}</p>}
    </div>
  );
}

function D({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-700">{value}</p>
    </div>
  );
}
