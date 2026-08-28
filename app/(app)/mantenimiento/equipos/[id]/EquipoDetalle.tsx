"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FichaTecnica from "./FichaTecnica";
import ComponentesYRepuestos from "./ComponentesYRepuestos";
import CostoDelEquipo, { type CostoDelEquipoProps } from "./CostoDelEquipo";

const OT_ESTADO: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  ATRASADO:   { label: "Atrasado",   color: "#DC2626", bg: "#FEF2F2", dot: "#EF4444" },
  EN_PROCESO: { label: "En proceso", color: "#1D4ED8", bg: "#EFF6FF", dot: "#3B82F6" },
  POR_HACER:  { label: "Por hacer",  color: "#B45309", bg: "#FFFBEB", dot: "#F59E0B" },
  REALIZADO:  { label: "Realizado",  color: "#16A34A", bg: "#F0FDF4", dot: "#22C55E" },
};

const STATUS_OPTIONS = [
  { value: "OPERATIVO",         label: "Operativo" },
  { value: "EN_MANTENIMIENTO",  label: "En mantenimiento" },
  { value: "EN_REPARACION",     label: "En reparación" },
  { value: "STANDBY",           label: "Standby" },
  { value: "FUERA_DE_SERVICIO", label: "Fuera de servicio" },
  { value: "DADO_DE_BAJA",      label: "Dado de baja" },
];

const CRITICALITY_OPTIONS = [
  { value: "ALTA",  label: "Alta" },
  { value: "MEDIA", label: "Media" },
  { value: "BAJA",  label: "Baja" },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  OPERATIVO:         { label: "Operativo",         color: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0", dot: "#22C55E" },
  EN_MANTENIMIENTO:  { label: "En mantenimiento",  color: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE", dot: "#3B82F6" },
  EN_REPARACION:     { label: "En reparación",     color: "#DC2626", bg: "#FEF2F2", border: "#FECACA", dot: "#EF4444" },
  STANDBY:           { label: "Standby",            color: "#B45309", bg: "#FFFBEB", border: "#FDE68A", dot: "#F59E0B" },
  FUERA_DE_SERVICIO: { label: "Fuera de servicio", color: "#475569", bg: "#F8FAFC", border: "#E2E8F0", dot: "#94A3B8" },
  DADO_DE_BAJA:      { label: "Dado de baja",      color: "#334155", bg: "#F1F5F9", border: "#CBD5E1", dot: "#64748B" },
};

// Requieren justificación al cambiar a este estado
const REQUIRES_REASON = new Set(["EN_MANTENIMIENTO", "EN_REPARACION", "STANDBY", "FUERA_DE_SERVICIO", "DADO_DE_BAJA"]);

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "—";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim() || "—";
}

export default function EquipoDetalle({ equipo, sectores, historial, canEdit, costo }: {
  equipo: any;
  sectores: any[];
  historial: any[];
  canEdit: boolean;
  costo: Omit<CostoDelEquipoProps, "equipoId">;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [workOrders, setWorkOrders] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/mantenimiento/ordenes?equipment_id=${equipo.id}&page=1`)
      .then(r => r.json())
      .then(d => setWorkOrders(d.data ?? []))
      .catch(() => {});
  }, [equipo.id]);

  const [statusModal, setStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState(equipo.status);
  const [reason, setReason]     = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError]   = useState("");

  const [form, setForm] = useState({
    name:        equipo.name,
    code:        equipo.code,
    sector_id:   equipo.sector_id,
    power_kw:    equipo.power_kw ?? "",
    description: equipo.description ?? "",
    status:      equipo.status,
    criticality: equipo.criticality,
    notes:       equipo.notes ?? "",
  });

  function field(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openStatusModal() {
    setNewStatus(equipo.status);
    setReason("");
    setStatusError("");
    setStatusModal(true);
  }

  const requiresReason = REQUIRES_REASON.has(newStatus);

  async function saveStatus() {
    if (requiresReason && !reason.trim()) {
      setStatusError("Ingresá una justificación para este cambio.");
      return;
    }
    setStatusSaving(true);
    setStatusError("");
    const res = await fetch(`/api/mantenimiento/equipos/${equipo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "change_status", new_status: newStatus, reason }),
    });
    const data = await res.json();
    if (!res.ok) { setStatusError(data.error ?? "Error al actualizar"); setStatusSaving(false); return; }
    setStatusSaving(false);
    setStatusModal(false);
    router.refresh();
  }

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/mantenimiento/equipos/${equipo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:        form.name.trim(),
        code:        form.code.trim(),
        sector_id:   form.sector_id,
        power_kw:    form.power_kw === "" ? null : Number(form.power_kw),
        description: form.description.trim() || null,
        criticality: form.criticality,
        notes:       form.notes.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Error al guardar"); setSaving(false); return; }
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  const meta = STATUS_META[equipo.status] ?? STATUS_META.OPERATIVO;
  const lastNonOp = historial.find((h: any) => h.new_status !== "OPERATIVO" || h.reason);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/mantenimiento/equipos" className="text-sm text-gray-400 hover:text-gray-700">← Equipos</Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{equipo.name}</h1>
          <p className="text-sm font-mono text-gray-400">{equipo.code}</p>
          <p className="text-sm text-gray-500 mt-0.5">
            {equipo.sectores?.empresas?.nombre ?? "Transversal"} · {equipo.sectores?.nombre}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Link
            href={`/mantenimiento/equipos/${equipo.id}/checklist`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Checklist
          </Link>

          {canEdit ? (
            <button
              onClick={openStatusModal}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all hover:opacity-80"
              style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
              title="Cambiar estado"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.dot }} />
              {meta.label}
              <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border"
              style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.dot }} />
              {meta.label}
            </span>
          )}

          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Editar
            </button>
          )}
        </div>
      </div>

      {equipo.status !== "OPERATIVO" && lastNonOp?.reason && (
        <div className="rounded-xl border px-4 py-3 flex items-start gap-3"
          style={{ background: meta.bg, borderColor: meta.border }}>
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            style={{ color: meta.color }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm">
            <span className="font-medium" style={{ color: meta.color }}>Motivo: </span>
            <span className="text-gray-700 italic">"{lastNonOp.reason}"</span>
            <span className="text-gray-400 text-xs ml-2">
              — {nombreCompleto(lastNonOp.changed_by_user)} · {new Date(lastNonOp.changed_at).toLocaleDateString("es-AR")}
            </span>
          </div>
        </div>
      )}

      {!editing && (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
          <Row label="Descripción"  value={equipo.description || "—"} />
          <Row label="Potencia"     value={equipo.power_kw != null ? `${equipo.power_kw} kW` : "—"} />
          <Row label="Criticidad"   value={equipo.criticality} />
          <Row label="Observaciones" value={equipo.notes || "—"} />
        </div>
      )}

      {editing && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre" required>
              <input value={form.name} onChange={(e) => field("name", e.target.value)} className="input" />
            </Field>
            <Field label="Código" required>
              <input value={form.code} onChange={(e) => field("code", e.target.value)} className="input" />
            </Field>
          </div>

          <Field label="Sector" required>
            <select value={form.sector_id} onChange={(e) => field("sector_id", e.target.value)} className="input">
              {sectores.map((s: any) => (
                <option key={s.id} value={s.id}>{s.empresas?.nombre ?? "Transversal"} · {s.nombre}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Criticidad">
              <select value={form.criticality} onChange={(e) => field("criticality", e.target.value)} className="input">
                {CRITICALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Potencia (kW)">
              <input type="number" value={form.power_kw} onChange={(e) => field("power_kw", e.target.value)}
                placeholder="—" className="input" />
            </Field>
          </div>

          <Field label="Descripción">
            <textarea value={form.description} onChange={(e) => field("description", e.target.value)}
              rows={2} className="input resize-none" />
          </Field>

          <Field label="Observaciones">
            <textarea value={form.notes} onChange={(e) => field("notes", e.target.value)}
              rows={2} className="input resize-none" />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving}
              className="btn-primary disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar"}
            </button>
            <button onClick={() => { setEditing(false); setError(""); }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <FichaTecnica equipo={equipo} puedeEditar={canEdit} />

      <ComponentesYRepuestos equipoId={equipo.id} puedeEditar={canEdit} />

      {historial.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Historial de estado</h2>
          <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
            {historial.map((h: any) => {
              const hMeta = STATUS_META[h.new_status] ?? STATUS_META.OPERATIVO;
              return (
                <div key={h.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-400 text-xs line-through">{STATUS_META[h.old_status]?.label ?? h.old_status}</span>
                      <span className="text-gray-300">→</span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border"
                        style={{ color: hMeta.color, background: hMeta.bg, borderColor: hMeta.border }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: hMeta.dot }} />
                        {hMeta.label}
                      </span>
                    </div>
                    <div className="text-right text-xs text-gray-400 shrink-0">
                      <div>{nombreCompleto(h.changed_by_user)}</div>
                      <div>{new Date(h.changed_at).toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })}</div>
                    </div>
                  </div>
                  {h.reason && (
                    <p className="mt-1 text-xs text-gray-500 italic">"{h.reason}"</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {workOrders.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Órdenes de Trabajo</h2>
            <Link href={`/mantenimiento/ordenes?equipment_id=${equipo.id}`} className="text-xs text-blue-500 hover:underline">
              Ver todas →
            </Link>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
            {workOrders.slice(0, 5).map((o: any) => {
              const m = OT_ESTADO[o.estado] ?? OT_ESTADO.POR_HACER;
              return (
                <div key={o.id} className="px-4 py-3 flex items-start gap-3 text-sm">
                  <span className="text-xs font-mono text-gray-400 w-10 shrink-0 pt-0.5">#{o.ot_number}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 text-sm leading-snug">{o.descripcion ?? "—"}</p>
                    {o.repuesto && <p className="text-xs text-gray-400 mt-0.5">Repuesto: {o.repuesto}</p>}
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border"
                      style={{ color: m.color, background: m.bg, borderColor: m.color + "33" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
                      {m.label}
                    </span>
                    {o.fecha && (
                      <p className="text-xs text-gray-400">{new Date(o.fecha).toLocaleDateString("es-AR")}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <CostoDelEquipo equipoId={equipo.id} {...costo} />

      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-gray-900">
              Cambiar estado — <span className="font-mono text-sm text-gray-500">{equipo.code}</span>
            </h2>

            <div className="space-y-2">
              {STATUS_OPTIONS.map((opt) => {
                const m = STATUS_META[opt.value];
                const selected = newStatus === opt.value;
                return (
                  <button key={opt.value}
                    onClick={() => { setNewStatus(opt.value); setStatusError(""); }}
                    className="w-full flex items-center gap-3 rounded-xl border-2 px-4 py-2.5 text-sm font-medium text-left transition-all"
                    style={{
                      borderColor: selected ? m.color : "#E2E8F0",
                      background:  selected ? m.bg : "#fff",
                      color:       selected ? m.color : "#475569",
                    }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.dot }} />
                    {opt.label}
                    {selected && (
                      <svg className="w-4 h-4 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            {requiresReason && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">
                  Justificación <span className="text-red-500">*</span>
                  <span className="font-normal text-gray-400 ml-1">— requerida para este estado</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); setStatusError(""); }}
                  rows={3}
                  className="input resize-none w-full"
                  placeholder="Ej: Falla en rodamiento, esperando repuesto..."
                />
              </div>
            )}

            {newStatus === equipo.status && (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                El equipo ya se encuentra en este estado.
              </p>
            )}

            {statusError && <p className="text-sm text-red-600">{statusError}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={saveStatus}
                disabled={statusSaving || newStatus === equipo.status}
                className="btn-primary disabled:opacity-50"
              >
                {statusSaving ? "Guardando..." : "Confirmar"}
              </button>
              <button onClick={() => setStatusModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 flex gap-4">
      <span className="text-sm text-gray-500 w-32 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
