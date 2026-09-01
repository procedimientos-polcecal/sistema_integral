"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ConfirmProvider";
import InfoTip from "@/components/InfoTip";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";

const TYPE_OPTIONS = [
  { value: "Lubricacion",       label: "Lubricación" },
  { value: "Inspeccion",        label: "Inspección" },
  { value: "Limpieza",          label: "Limpieza" },
  { value: "Ajuste",            label: "Ajuste" },
  { value: "Reemplazo",         label: "Reemplazo" },
  { value: "Revision_electrica",label: "Revisión eléctrica" },
  { value: "Otro",              label: "Otro" },
];

const SCHEDULE_OPTIONS = [
  { value: "DIARIO",     label: "Diario" },
  { value: "SEMANAL",    label: "Semanal" },
  { value: "QUINCENAL",  label: "Quincenal" },
  { value: "MENSUAL",    label: "Mensual" },
  { value: "TRIMESTRAL", label: "Trimestral" },
  { value: "SEMESTRAL",  label: "Semestral" },
  { value: "ANUAL",      label: "Anual" },
  { value: "PERSONALIZADO", label: "Personalizado (días)" },
  { value: "FECHA_FIJA", label: "Fecha fija (única)" },
];

const STATUS_COLORS: Record<string, string> = {
  active:    "bg-green-100 text-green-800",
  paused:    "bg-yellow-100 text-yellow-800",
  completed: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-700",
};

const STATUS_LABEL: Record<string, string> = {
  active:    "Activo",
  paused:    "Pausado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const EMPTY_FORM = {
  equipment_id:    "",
  maintenance_type:"Inspeccion",
  schedule_type:   "MENSUAL",
  interval_days:   "",
  next_date:       "",
  assigned_to:     "",
  description:     "",
  estimated_hours: "",
};

const OT_ESTADO_META: Record<string, { label: string; color: string; bg: string }> = {
  POR_HACER:  { label: "Por hacer",  color: "#B45309", bg: "#FFFBEB" },
  EN_PROCESO: { label: "En proceso", color: "#1D4ED8", bg: "#EFF6FF" },
  ATRASADO:   { label: "Atrasado",   color: "#DC2626", bg: "#FEF2F2" },
  REALIZADO:  { label: "Realizado",  color: "#16A34A", bg: "#F0FDF4" },
  SUSPENDIDA: { label: "Suspendida", color: "#B45309", bg: "#FFFBEB" },
};

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "—";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim() || "—";
}

export default function MantenimientosClient({ schedules, equipos, users, linkedOts, canEdit }: {
  schedules: any[];
  equipos: any[];
  users: any[];
  linkedOts: any[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [refPhotos, setRefPhotos] = useState<File[]>([]);
  const [refPreviews, setRefPreviews] = useState<string[]>([]);

  const [otBusy, setOtBusy] = useState<string | null>(null);
  const [otMsg, setOtMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [linkModal, setLinkModal] = useState<any>(null);

  const otsBySchedule = new Map<string, any[]>();
  for (const ot of linkedOts) {
    const arr = otsBySchedule.get(ot.schedule_id) ?? [];
    arr.push(ot);
    otsBySchedule.set(ot.schedule_id, arr);
  }

  async function crearOT(s: any) {
    const ok = await confirm({
      title: "Crear orden de trabajo",
      message: `Se generará una nueva OT a partir de este mantenimiento (${s.equipos?.code ?? ""}). ¿Continuar?`,
      confirmText: "Crear OT",
    });
    if (!ok) return;
    setOtBusy(s.id); setOtMsg(null);
    const eq = s.equipos;
    const body = {
      equipment_id:    s.equipment_id,
      sector_id:       eq?.sector_id ?? null,
      sector_raw:      eq?.sectores?.nombre ?? null,
      equipo_raw:      eq ? `${eq.code} — ${eq.name}` : null,
      equipo_code:     eq?.code ?? null,
      especialidad:    s.maintenance_type ?? null,
      tipo:            "PROGRAMADO",
      descripcion:     s.description?.trim() || `${s.maintenance_type} — ${eq?.name ?? ""}`.trim(),
      fecha_ejecucion: s.next_date ?? null,
      estado:          "POR_HACER",
      horas:           s.estimated_hours ?? null,
      quien:           nombreCompleto(s.assigned_user),
      schedule_id:     s.id,
    };
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setOtBusy(null);
    if (!res.ok) { setOtMsg({ id: s.id, text: data.error ?? "Error al crear OT", ok: false }); return; }
    setOtMsg({ id: s.id, text: `OT #${data.ot_number} creada`, ok: true });
    router.refresh();
  }

  async function vincularOT(scheduleId: string, workOrderId: string) {
    setOtBusy(scheduleId);
    await fetch("/api/mantenimiento/ordenes/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work_order_id: workOrderId, schedule_id: scheduleId }),
    });
    setOtBusy(null);
    setLinkModal(null);
    router.refresh();
  }

  async function desvincularOT(workOrderId: string) {
    const ok = await confirm({
      title: "Desvincular OT",
      message: "La orden de trabajo dejará de estar asociada a este mantenimiento. La OT en sí no se elimina. ¿Continuar?",
      confirmText: "Desvincular",
      danger: true,
    });
    if (!ok) return;
    await fetch("/api/mantenimiento/ordenes/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work_order_id: workOrderId, schedule_id: null }),
    });
    router.refresh();
  }

  function handleRefPhotos(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files).slice(0, 3);
    setRefPhotos((p) => [...p, ...arr].slice(0, 3));
    arr.forEach((f) => {
      const reader = new FileReader();
      reader.onload = (e) => setRefPreviews((p) => [...p, e.target?.result as string]);
      reader.readAsDataURL(f);
    });
  }

  function removeRefPhoto(idx: number) {
    setRefPhotos((p) => p.filter((_, i) => i !== idx));
    setRefPreviews((p) => p.filter((_, i) => i !== idx));
  }

  async function uploadRefPhotos(scheduleId: string): Promise<string[]> {
    if (refPhotos.length === 0) return [];
    const supabase = createClient();
    const urls: string[] = [];
    for (const photo of refPhotos) {
      const ext = photo.name.split(".").pop() ?? "jpg";
      const path = `schedules/${scheduleId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("execution-photos")
        .upload(path, photo, { upsert: false });
      if (!error) {
        const { data } = supabase.storage.from("execution-photos").getPublicUrl(path);
        urls.push(data.publicUrl);
      }
    }
    return urls;
  }

  function field(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openNew() {
    setForm({ ...EMPTY_FORM });
    setEditing(null);
    setRefPhotos([]);
    setRefPreviews([]);
    setShowForm(true);
    setError("");
  }

  function openEdit(s: any) {
    setForm({
      equipment_id:    s.equipment_id,
      maintenance_type:s.maintenance_type,
      schedule_type:   s.schedule_type,
      interval_days:   s.interval_days ?? "",
      next_date:       s.next_date ?? "",
      assigned_to:     s.assigned_to ?? "",
      description:     s.description ?? "",
      estimated_hours: s.estimated_hours ?? "",
    });
    setEditing(s);
    setRefPhotos([]);
    setRefPreviews([]);
    setShowForm(true);
    setError("");
  }

  async function save() {
    if (!form.equipment_id || !form.next_date) {
      setError("Equipo y fecha próxima son obligatorios.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();

    const payload: any = {
      equipment_id:    form.equipment_id,
      maintenance_type:form.maintenance_type,
      schedule_type:   form.schedule_type,
      next_date:       form.next_date,
      assigned_to:     form.assigned_to || null,
      description:     form.description.trim() || null,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
      interval_days:
        form.schedule_type === "PERSONALIZADO" && form.interval_days
          ? Number(form.interval_days)
          : null,
    };

    let err;
    if (editing) {
      if (refPhotos.length > 0) {
        const urls = await uploadRefPhotos(editing.id);
        if (urls.length > 0) payload.reference_photos = urls;
      }
      ({ error: err } = await supabase
        .from("mantenimientos_programados")
        .update(payload)
        .eq("id", editing.id));
    } else {
      payload.status = "active";
      const { data: inserted, error: insErr } = await supabase
        .from("mantenimientos_programados")
        .insert(payload)
        .select("id")
        .single();
      if (!insErr && inserted && refPhotos.length > 0) {
        const urls = await uploadRefPhotos(inserted.id);
        if (urls.length > 0) {
          await supabase
            .from("mantenimientos_programados")
            .update({ reference_photos: urls })
            .eq("id", inserted.id);
        }
      }
      err = insErr;
    }

    if (err) { setError(err.message); setSaving(false); return; }
    setSaving(false);
    setShowForm(false);
    router.refresh();
  }

  async function toggleStatus(s: any) {
    const pausar = s.status === "active";
    const ok = await confirm({
      title: pausar ? "Pausar mantenimiento" : "Activar mantenimiento",
      message: pausar
        ? "Un mantenimiento pausado deja de generar alertas y no aparece como vencido. ¿Pausarlo?"
        : "El mantenimiento volverá a estar activo y a generar alertas según su frecuencia. ¿Activarlo?",
      confirmText: pausar ? "Pausar" : "Activar",
    });
    if (!ok) return;
    const supabase = createClient();
    const newStatus = pausar ? "paused" : "active";
    await supabase
      .from("mantenimientos_programados")
      .update({ status: newStatus })
      .eq("id", s.id);
    router.refresh();
  }

  async function deleteSchedule(s: any) {
    const ok = await confirm({
      title: "Eliminar mantenimiento",
      message: `Se eliminará el mantenimiento de ${s.equipos?.code ?? ""}. Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("mantenimientos_programados")
      .delete()
      .eq("id", s.id);
    if (error) {
      const fk = error.code === "23503" || /foreign key|violates/i.test(error.message);
      alert(fk
        ? "No se puede eliminar: este mantenimiento tiene ejecuciones registradas en su historial. Pausalo o cancelalo en su lugar."
        : "No se pudo eliminar: " + error.message);
      return;
    }
    router.refresh();
  }

  // Hoy y el limite de "pronto", una sola vez por render y en hora de Argentina.
  //
  // Estaban los dos mal: `toISOString()` convierte a UTC antes de recortar, asi
  // que desde las 21:00 "hoy" era mañana y un mantenimiento de hoy aparecia
  // vencido. Y el limite se recalculaba dentro del `.map()`, o sea una vez por
  // fila, con un `Date.now()` distinto cada vez.
  const today = hoyEnArgentina();
  const dentroDeUnaSemana = sumarDias(today, 7);

  const filtered = schedules.filter((s) =>
    filterStatus ? s.status === filterStatus : true
  );

  return (
    <div className="md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Mantenimientos
          <InfoTip text="Acá programás los mantenimientos preventivos de cada equipo: qué tarea, cada cuánto se repite y quién la hace. El sistema avisa cuando se acercan o vencen, y desde cada uno podés generar o vincular una orden de trabajo (OT)." />
        </h1>
        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none"
          >
            <option value="">Todos</option>
            <option value="active">Activos</option>
            <option value="paused">Pausados</option>
            <option value="cancelled">Cancelados</option>
            <option value="completed">Completados</option>
          </select>
          {canEdit && (
            <button
              onClick={openNew}
              className="btn-primary"
            >
              + Nuevo
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">
            Sin mantenimientos programados.
          </div>
        )}
        {filtered.map((s: any) => {
          const overdue = s.next_date && s.next_date < today && s.status === "active";
          const soon = s.next_date && s.next_date >= today &&
            s.next_date <= dentroDeUnaSemana &&
            s.status === "active";

          return (
            <div
              key={s.id}
              className={`rounded-xl border bg-white p-4 ${
                overdue ? "border-red-200 bg-red-50" : "border-gray-200"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 text-sm">
                      {s.equipos?.code} — {s.equipos?.name}
                    </span>
                    <span className="text-xs text-gray-400">
                      {s.equipos?.sectores?.empresas?.nombre ?? "Transversal"} · {s.equipos?.sectores?.nombre}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
                    <span>{s.maintenance_type}</span>
                    <span>·</span>
                    <span>{SCHEDULE_OPTIONS.find((o) => o.value === s.schedule_type)?.label ?? s.schedule_type}</span>
                    {s.interval_days && <span>· cada {s.interval_days} días</span>}
                    {s.assigned_user && (
                      <><span>·</span><span>{nombreCompleto(s.assigned_user)}</span></>
                    )}
                    {s.estimated_hours && (
                      <><span>·</span><span>{s.estimated_hours} h est.</span></>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-xs text-gray-400 mt-1">{s.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className={`text-xs font-semibold ${overdue ? "text-red-700" : soon ? "text-yellow-700" : "text-gray-700"}`}>
                      {s.next_date ? new Date(s.next_date + "T00:00:00").toLocaleDateString("es-AR") : "—"}
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium mt-0.5 ${STATUS_COLORS[s.status] ?? ""}`}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => openEdit(s)}
                        className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleStatus(s)}
                        className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                      >
                        {s.status === "active" ? "Pausar" : "Activar"}
                      </button>
                      <button
                        onClick={() => deleteSchedule(s)}
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors"
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                {(otsBySchedule.get(s.id) ?? []).map((ot: any) => {
                  const m = OT_ESTADO_META[ot.estado] ?? { label: ot.estado, color: "#64748B", bg: "#F1F5F9" };
                  return (
                    <span key={ot.id}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border"
                      style={{ color: m.color, background: m.bg, borderColor: m.color + "33" }}>
                      OT #{ot.ot_number} · {m.label}
                      {canEdit && (
                        <button onClick={() => desvincularOT(ot.id)} title="Desvincular"
                          className="ml-0.5 text-gray-400 hover:text-red-600 leading-none">×</button>
                      )}
                    </span>
                  );
                })}
                {(otsBySchedule.get(s.id)?.length ?? 0) === 0 && (
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    Sin OT vinculada
                    <InfoTip text="Una orden de trabajo (OT) es el documento concreto del trabajo a realizar. 'Crear OT' genera una nueva a partir de este mantenimiento; 'Vincular OT' asocia una que ya existe en el sistema." />
                  </span>
                )}
                {canEdit && (
                  <div className="ml-auto flex items-center gap-2">
                    {otMsg && otMsg.id === s.id && (
                      <span className={`text-xs ${otMsg.ok ? "text-green-600" : "text-red-600"}`}>{otMsg.text}</span>
                    )}
                    <button onClick={() => crearOT(s)} disabled={otBusy === s.id}
                      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40">
                      {otBusy === s.id ? "..." : "+ Crear OT"}
                    </button>
                    <button onClick={() => setLinkModal(s)}
                      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                      Vincular OT
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-bold text-gray-900">
              {editing ? "Editar mantenimiento" : "Nuevo mantenimiento"}
            </h2>

            <div className="space-y-3">
              <Field label="Equipo" required>
                <select value={form.equipment_id} onChange={(e) => field("equipment_id", e.target.value)} className="input">
                  <option value="">Seleccioná un equipo...</option>
                  {equipos.map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.code} — {e.name} ({e.sectores?.empresas?.nombre ?? "Transversal"})
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo">
                  <select value={form.maintenance_type} onChange={(e) => field("maintenance_type", e.target.value)} className="input">
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Frecuencia">
                  <select value={form.schedule_type} onChange={(e) => field("schedule_type", e.target.value)} className="input">
                    {SCHEDULE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>

              {form.schedule_type === "PERSONALIZADO" && (
                <Field label="Cada cuántos días">
                  <input type="number" min="1" value={form.interval_days}
                    onChange={(e) => field("interval_days", e.target.value)} className="input" />
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Próxima fecha" required>
                  <input type="date" value={form.next_date}
                    onChange={(e) => field("next_date", e.target.value)} className="input" />
                </Field>
                <Field label="Horas estimadas">
                  <input type="number" min="0" step="0.5" value={form.estimated_hours}
                    onChange={(e) => field("estimated_hours", e.target.value)}
                    placeholder="—" className="input" />
                </Field>
              </div>

              <Field label="Asignar a">
                <select value={form.assigned_to} onChange={(e) => field("assigned_to", e.target.value)} className="input">
                  <option value="">Sin asignar</option>
                  {users.map((u: any) => (
                    <option key={u.id} value={u.id}>{nombreCompleto(u)}</option>
                  ))}
                </select>
              </Field>

              <Field label="Descripción / tarea">
                <textarea value={form.description} onChange={(e) => field("description", e.target.value)}
                  rows={3} className="input resize-none" placeholder="Detalle de la tarea a realizar..." />
              </Field>

              <Field label="Fotos de referencia (hasta 3)">
                <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-gray-300 px-4 py-3 hover:border-blue-400 transition-colors">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs text-gray-500">
                    {refPhotos.length === 0 ? "Adjuntar foto..." : `${refPhotos.length} foto(s) seleccionada(s)`}
                  </span>
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => handleRefPhotos(e.target.files)} />
                </label>
                {refPreviews.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {refPreviews.map((src, i) => (
                      <div key={i} className="relative">
                        <img src={src} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                        <button type="button" onClick={() => removeRefPhoto(i)}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {linkModal && (
        <LinkOTModal
          schedule={linkModal}
          busy={otBusy === linkModal.id}
          onClose={() => setLinkModal(null)}
          onPick={(otId) => vincularOT(linkModal.id, otId)}
        />
      )}
    </div>
  );
}

function LinkOTModal({ schedule, busy, onClose, onPick }: {
  schedule: any; busy: boolean;
  onClose: () => void; onPick: (workOrderId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function search(term: string) {
    setLoading(true);
    const params = new URLSearchParams({ page: "1" });
    if (term.trim()) params.set("q", term.trim());
    const res = await fetch(`/api/mantenimiento/ordenes?${params}`);
    const json = await res.json();
    setResults(json.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 space-y-3 shadow-xl max-h-[85vh] flex flex-col">
        <h2 className="text-base font-bold text-gray-900">Vincular OT existente</h2>
        <p className="text-xs text-gray-400">
          {schedule.equipos?.code} — {schedule.equipos?.name}
        </p>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por N° OT, equipo, descripción..." className="input" />
        <div className="flex-1 overflow-y-auto space-y-1.5 -mx-1 px-1">
          {loading && <p className="text-sm text-gray-400 py-4 text-center">Buscando...</p>}
          {!loading && results.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">Sin resultados.</p>
          )}
          {!loading && results.map((o) => {
            const m = OT_ESTADO_META[o.estado] ?? { label: o.estado, color: "#64748B", bg: "#F1F5F9" };
            return (
              <button key={o.id} onClick={() => onPick(o.id)} disabled={busy}
                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 transition-colors disabled:opacity-40 flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-gray-500 shrink-0">#{o.ot_number}</span>
                <span className="text-sm text-gray-800 truncate flex-1">{o.descripcion ?? "—"}</span>
                <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ color: m.color, background: m.bg }}>{m.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cerrar
          </button>
        </div>
      </div>
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
