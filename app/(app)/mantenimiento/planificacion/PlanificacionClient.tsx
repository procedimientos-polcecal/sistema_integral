"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConfirm } from "@/components/ConfirmProvider";
import InfoTip from "@/components/InfoTip";

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "—";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim() || "—";
}

export default function PlanificacionClient({ plans, canEdit }: { plans: any[]; canEdit: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [showNew, setShowNew]   = useState(false);
  const [fecha, setFecha]       = useState(new Date().toISOString().slice(0, 10));
  const [titulo, setTitulo]     = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  async function deletePlan(id: string) {
    const ok = await confirm({
      title: "Eliminar plan",
      message: "Se eliminará este plan de trabajo y todas sus órdenes asociadas al plan. Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setDeleting(id);
    await fetch(`/api/mantenimiento/planificacion/${id}`, { method: "DELETE" });
    setDeleting(null);
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError("");
    const res = await fetch("/api/mantenimiento/planificacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, titulo }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Error"); setSaving(false); return; }
    router.push(`/mantenimiento/planificacion/${data.data.id}`);
  }

  return (
    <div className="md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Planificación diaria
            <InfoTip text="Armás el plan de trabajo de un día: elegís qué órdenes de trabajo se hacen, a quién se asignan, y después generás la hoja para imprimir o guardar en PDF. Cada plan agrupa varias OTs para una fecha." />
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Programá el trabajo del día y generá las órdenes para imprimir</p>
        </div>
        {canEdit && (
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo plan
          </button>
        )}
      </div>

      {plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <svg className="w-8 h-8 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-400 text-sm">Todavía no hay planes. Creá el primero.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {plans.map((p) => {
            const fecha = new Date(p.fecha + "T12:00:00");
            const itemCount = p.planificacion_diaria_items?.length ?? 0;
            const isToday = p.fecha === new Date().toISOString().slice(0, 10);
            return (
              <div key={p.id} className="flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors">
              <Link href={`/mantenimiento/planificacion/${p.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`shrink-0 w-14 rounded-xl text-center py-1.5 ${isToday ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>
                  <div className="text-lg font-bold leading-none">{fecha.getDate()}</div>
                  <div className="text-xs mt-0.5 capitalize">
                    {fecha.toLocaleDateString("es-AR", { month: "short" })}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {p.titulo || fecha.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
                    {isToday && <span className="ml-2 text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Hoy</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {itemCount} {itemCount === 1 ? "orden" : "órdenes"}
                    {p.created_by_user ? ` · ${nombreCompleto(p.created_by_user)}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400">{itemCount > 0 ? `${itemCount} OT` : "—"}</span>
                  <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
              {canEdit && (
                <button
                  onClick={() => deletePlan(p.id)}
                  disabled={deleting === p.id}
                  className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                  title="Eliminar plan">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-gray-900">Nuevo plan de trabajo</h2>
            <form onSubmit={create} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">Fecha <span className="text-red-500">*</span></label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                  className="input w-full" required />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">Título (opcional)</label>
                <input value={titulo} onChange={e => setTitulo(e.target.value)}
                  placeholder="Ej: Mantenimiento semanal calcinación"
                  className="input w-full" />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={saving}
                  className="btn-primary disabled:opacity-50">
                  {saving ? "Creando..." : "Crear plan"}
                </button>
                <button type="button" onClick={() => setShowNew(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
