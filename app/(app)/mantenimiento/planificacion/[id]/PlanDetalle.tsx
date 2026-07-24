"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

const ESTADO_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  ATRASADO:   { label: "Atrasado",   color: "#DC2626", bg: "#FEF2F2", dot: "#EF4444" },
  EN_PROCESO: { label: "En proceso", color: "#1D4ED8", bg: "#EFF6FF", dot: "#3B82F6" },
  POR_HACER:  { label: "Por hacer",  color: "#B45309", bg: "#FFFBEB", dot: "#F59E0B" },
  REALIZADO:  { label: "Realizado",  color: "#16A34A", bg: "#F0FDF4", dot: "#22C55E" },
};

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim();
}

export default function PlanDetalle({ plan, pendingOTs, usuarios, sectores, canEdit }: {
  plan: any; pendingOTs: any[]; usuarios: any[]; sectores: any[]; canEdit: boolean;
}) {
  const [items, setItems]         = useState<any[]>(
    [...(plan.planificacion_diaria_items ?? [])].sort((a, b) => a.orden - b.orden)
  );
  const [showAddOT, setShowAddOT] = useState(false);
  const [saving, setSaving]       = useState(false);

  const [filterSector, setFilterSector] = useState("");
  const [filterQ, setFilterQ]           = useState("");
  const [editItem, setEditItem]         = useState<any | null>(null);

  const planDate = new Date(plan.fecha + "T12:00:00");

  const alreadyIds = new Set(items.map((i: any) => i.work_order_id).filter(Boolean));
  const availableOTs = useMemo(() => pendingOTs.filter(o => {
    if (alreadyIds.has(o.id)) return false;
    if (filterSector && o.sector_id !== filterSector) return false;
    if (filterQ) {
      const q = filterQ.toLowerCase();
      return (o.descripcion ?? "").toLowerCase().includes(q)
        || (o.equipo_raw ?? "").toLowerCase().includes(q)
        || String(o.ot_number).includes(q);
    }
    return true;
  }), [pendingOTs, alreadyIds, filterSector, filterQ]);

  async function addOT(ot: any) {
    setSaving(true);
    const res = await fetch(`/api/mantenimiento/planificacion/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_item",
        work_order_id:  ot.id,
        ot_number:      ot.ot_number,
        especialidad:   ot.especialidad,
        sector_raw:     ot.sector_raw,
        equipo_raw:     ot.equipo_raw,
        descripcion:    ot.descripcion,
        repuesto:       ot.repuesto,
        fecha_ejecucion: plan.fecha,
      }),
    });
    const data = await res.json();
    if (res.ok) setItems(prev => [...prev, data.data]);
    setSaving(false);
  }

  async function removeItem(itemId: string) {
    await fetch(`/api/mantenimiento/planificacion/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_item", item_id: itemId }),
    });
    setItems(prev => prev.filter(i => i.id !== itemId));
  }

  async function saveItemEdit(itemId: string, assigned_to: string, assigned_name: string, notas_item: string) {
    const res = await fetch(`/api/mantenimiento/planificacion/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_item", item_id: itemId, assigned_to, assigned_name, notas_item }),
    });
    const data = await res.json();
    if (res.ok) setItems(prev => prev.map(i => i.id === itemId ? data.data : i));
    setEditItem(null);
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <Link href="/mantenimiento/planificacion" className="text-sm text-gray-400 hover:text-gray-700">← Planificación</Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {plan.titulo || planDate.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {planDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
            {plan.created_by_user ? ` · Creado por ${nombreCompleto(plan.created_by_user)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <Link href={`/mantenimiento/planificacion/${plan.id}/imprimir`} target="_blank"
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Imprimir
            </Link>
          )}
          {canEdit && (
            <button onClick={() => setShowAddOT(true)}
              className="btn-primary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Agregar OT
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <p className="text-gray-400 text-sm">Todavía no hay órdenes en este plan.</p>
          {canEdit && (
            <button onClick={() => setShowAddOT(true)}
              className="mt-3 text-blue-500 text-sm hover:underline">
              + Agregar OT
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, idx) => {
            const assignee = nombreCompleto(item.assigned_user) || item.assigned_name || null;
            return (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="px-4 py-3 flex items-start gap-3">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-gray-400">#{item.ot_number}</span>
                      {item.especialidad && (
                        <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                          {item.especialidad}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5 leading-snug">{item.descripcion}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.sector_raw}{item.equipo_raw ? ` · ${item.equipo_raw}` : ""}</p>
                    {item.repuesto && <p className="text-xs text-gray-500 mt-0.5">Repuesto: {item.repuesto}</p>}
                    {item.notas_item && <p className="text-xs text-blue-600 mt-0.5 italic">"{item.notas_item}"</p>}
                  </div>
                  <div className="shrink-0 text-right space-y-1.5">
                    {assignee ? (
                      <div className="flex items-center gap-1.5 justify-end">
                        <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-xs font-bold text-blue-600">
                            {assignee.split(" ").map((n: string) => n[0]).slice(0, 2).join("")}
                          </span>
                        </div>
                        <span className="text-xs font-medium text-gray-700">{assignee}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">Sin asignar</span>
                    )}
                    {canEdit && (
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => setEditItem(item)}
                          className="text-xs text-gray-400 hover:text-blue-600 transition-colors">
                          Editar
                        </button>
                        <span className="text-gray-200">·</span>
                        <button onClick={() => removeItem(item.id)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                          Quitar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddOT && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Agregar órdenes al plan</h2>
              <button onClick={() => setShowAddOT(false)} className="p-1 text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <select value={filterSector} onChange={e => setFilterSector(e.target.value)}
                  className="input flex-1 text-sm">
                  <option value="">Todos los sectores</option>
                  {sectores.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.empresas?.nombre ?? "Transversal"} · {s.nombre}</option>
                  ))}
                </select>
                <input value={filterQ} onChange={e => setFilterQ(e.target.value)}
                  placeholder="Buscar OT..." className="input flex-1 text-sm" />
              </div>

              <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 rounded-xl border border-gray-200">
                {availableOTs.length === 0 ? (
                  <div className="py-10 text-center text-sm text-gray-400">No hay OTs pendientes con esos filtros.</div>
                ) : availableOTs.map(ot => {
                  const meta = ESTADO_META[ot.estado] ?? ESTADO_META.POR_HACER;
                  return (
                    <button key={ot.id} onClick={() => { addOT(ot); }}
                      disabled={saving}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-start gap-3 disabled:opacity-50">
                      <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: meta.dot }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-gray-400">#{ot.ot_number}</span>
                          {ot.especialidad && <span className="text-xs text-gray-500">{ot.especialidad}</span>}
                          <span className="ml-auto text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                        </div>
                        <p className="text-sm font-medium text-gray-800 mt-0.5 leading-snug line-clamp-2">{ot.descripcion}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{ot.sector_raw}{ot.equipo_raw ? ` · ${ot.equipo_raw}` : ""}</p>
                      </div>
                      <svg className="w-4 h-4 text-blue-400 shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {editItem && (
        <EditItemModal item={editItem} usuarios={usuarios}
          onSave={(assigned_to, assigned_name, notas_item) =>
            saveItemEdit(editItem.id, assigned_to, assigned_name, notas_item)}
          onClose={() => setEditItem(null)} />
      )}
    </div>
  );
}

function EditItemModal({ item, usuarios, onSave, onClose }: {
  item: any; usuarios: any[];
  onSave: (a: string, b: string, c: string) => void;
  onClose: () => void;
}) {
  const [assignedTo, setAssignedTo]     = useState(item.assigned_to ?? "");
  const [assignedName, setAssignedName] = useState(item.assigned_name ?? "");
  const [notas, setNotas]               = useState(item.notas_item ?? "");
  const [saving, setSaving]             = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave(assignedTo, assignedName, notas);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <h2 className="text-sm font-bold text-gray-900">Asignar OT #{item.ot_number}</h2>
        <p className="text-xs text-gray-500 -mt-2 leading-snug">{item.descripcion}</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Asignar a (usuario del sistema)</label>
            <select value={assignedTo} onChange={e => { setAssignedTo(e.target.value); if (e.target.value) setAssignedName(""); }}
              className="input w-full">
              <option value="">— Nombre libre —</option>
              {usuarios.map((u: any) => <option key={u.id} value={u.id}>{nombreCompleto(u)}</option>)}
            </select>
          </div>
          {!assignedTo && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-600">O escribir nombre</label>
              <input value={assignedName} onChange={e => setAssignedName(e.target.value)}
                placeholder="Nombre del operario" className="input w-full" />
            </div>
          )}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Notas adicionales</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)}
              rows={2} className="input resize-none w-full"
              placeholder="Ej: Llevar llave 32, coordinar con calcinación..." />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving}
              className="btn-primary disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar"}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
