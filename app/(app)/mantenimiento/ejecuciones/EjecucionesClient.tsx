"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import InfoTip from "@/components/InfoTip";

const STATUS_COLORS: Record<string, string> = {
  completado: "bg-green-100 text-green-800",
  parcial:    "bg-yellow-100 text-yellow-800",
  cancelado:  "bg-red-100 text-red-800",
};

const EMPTY_FORM = {
  schedule_id:        "",
  execution_status:   "completado",
  executed_at:        new Date().toISOString().slice(0, 16),
  duration_hours:     "",
  observations:       "",
  next_date_override: "",
};

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "—";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim() || "—";
}

export default function EjecucionesClient({ schedules, executions, currentUserId, canExecute }: {
  schedules: any[];
  executions: any[];
  currentUserId: string;
  canExecute: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"pendientes" | "recientes">("pendientes");

  const [checklist, setChecklist] = useState<any>(null);
  const [checklistResponses, setChecklistResponses] = useState<Record<string, any>>({});

  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreview, setPhotoPreview] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  function field(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function openFor(scheduleId: string) {
    setForm({ ...EMPTY_FORM, schedule_id: scheduleId });
    setChecklistResponses({});
    setPhotos([]);
    setPhotoPreview([]);
    setError("");

    const schedule = schedules.find((s) => s.id === scheduleId);
    if (schedule?.equipos?.id) {
      const supabase = createClient();
      const { data } = await supabase
        .from("equipos_checklists")
        .select("*")
        .eq("equipment_id", schedule.equipos.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setChecklist(data ?? null);
    } else {
      setChecklist(null);
    }
    setShowForm(true);
  }

  function handlePhotos(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files).slice(0, 5);
    setPhotos((prev) => [...prev, ...arr].slice(0, 5));
    arr.forEach((f) => {
      const reader = new FileReader();
      reader.onload = (e) => setPhotoPreview((prev) => [...prev, e.target?.result as string]);
      reader.readAsDataURL(f);
    });
  }

  function removePhoto(idx: number) {
    setPhotos((p) => p.filter((_, i) => i !== idx));
    setPhotoPreview((p) => p.filter((_, i) => i !== idx));
  }

  async function uploadPhotos(scheduleId: string): Promise<string[]> {
    if (photos.length === 0) return [];
    setUploadingPhotos(true);
    const supabase = createClient();
    const urls: string[] = [];
    for (const photo of photos) {
      const ext = photo.name.split(".").pop() ?? "jpg";
      const path = `${currentUserId}/${scheduleId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("execution-photos")
        .upload(path, photo, { upsert: false });
      if (!error) {
        const { data } = supabase.storage.from("execution-photos").getPublicUrl(path);
        urls.push(data.publicUrl);
      }
    }
    setUploadingPhotos(false);
    return urls;
  }

  async function save() {
    if (!form.schedule_id) { setError("Seleccioná un mantenimiento."); return; }

    if (checklist?.items) {
      const missing = checklist.items.filter(
        (item: any) => item.required && (checklistResponses[item.id] === undefined || checklistResponses[item.id] === "")
      );
      if (missing.length > 0) {
        setError(`Completá los ítems obligatorios: ${missing.map((i: any) => i.label).join(", ")}`);
        return;
      }
    }

    setSaving(true);
    setError("");

    const photoUrls = await uploadPhotos(form.schedule_id);

    const payload = {
      schedule_id:         form.schedule_id,
      execution_status:    form.execution_status,
      executed_at:         form.executed_at,
      duration_hours:      form.duration_hours ? Number(form.duration_hours) : null,
      observations:        form.observations.trim() || null,
      checklist_snapshot:  checklist ?? null,
      checklist_responses: checklist ? checklistResponses : null,
      next_date_override:  form.next_date_override || null,
      photo_urls:          photoUrls,
    };

    const res = await fetch("/api/mantenimiento/ejecuciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Error al guardar.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setShowForm(false);
    router.refresh();
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Ejecuciones
          <InfoTip text="Registrás que un mantenimiento fue realizado: quién lo hizo, cuándo, el resultado del checklist, observaciones y fotos. Al registrarlo, el sistema recalcula automáticamente la próxima fecha del mantenimiento." />
        </h1>
        {canExecute && (
          <button
            onClick={() => { setForm({ ...EMPTY_FORM }); setChecklist(null); setPhotos([]); setPhotoPreview([]); setShowForm(true); setError(""); }}
            className="btn-primary"
          >
            + Registrar
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {(["pendientes", "recientes"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "pendientes" && (
        <div className="space-y-2">
          {schedules.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Sin mantenimientos activos.</p>}
          {schedules.map((s: any) => {
            const overdue = s.next_date && s.next_date < today;
            const soon = s.next_date && s.next_date >= today &&
              s.next_date <= new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
            return (
              <div key={s.id} className={`rounded-xl border bg-white p-4 flex items-start justify-between gap-4 ${overdue ? "border-red-200 bg-red-50" : "border-gray-200"}`}>
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{s.equipos?.code} — {s.equipos?.name}</p>
                  <p className="text-xs text-gray-500">
                    {s.maintenance_type} · {s.equipos?.sectores?.empresas?.nombre ?? "Transversal"} · {s.equipos?.sectores?.nombre}
                    {s.assigned_user && ` · ${nombreCompleto(s.assigned_user)}`}
                    {s.estimated_hours && ` · ${s.estimated_hours} h`}
                  </p>
                  {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className={`text-xs font-semibold ${overdue ? "text-red-700" : soon ? "text-yellow-700" : "text-gray-600"}`}>
                    {s.next_date ? new Date(s.next_date + "T00:00:00").toLocaleDateString("es-AR") : "—"}
                  </div>
                  {canExecute && (
                    <button onClick={() => openFor(s.id)}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors whitespace-nowrap">
                      Registrar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "recientes" && (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {executions.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Sin ejecuciones registradas.</p>}
          {executions.map((e: any) => (
            <div key={e.id} className="px-4 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{e.schedule?.equipos?.code} — {e.schedule?.equipos?.name}</p>
                <p className="text-xs text-gray-500">
                  {e.schedule?.maintenance_type} · {nombreCompleto(e.executor)}
                  {e.duration_hours && ` · ${e.duration_hours} h`}
                </p>
                {e.observations && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{e.observations}</p>}
                {e.photo_urls?.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {e.photo_urls.map((url: string, i: number) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer"
                        className="text-xs text-blue-500 underline">📷 Foto {i + 1}</a>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right space-y-0.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[e.execution_status] ?? ""}`}>
                  {e.execution_status}
                </span>
                <p className="text-xs text-gray-400">{new Date(e.executed_at).toLocaleDateString("es-AR")}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-bold text-gray-900">Registrar ejecución</h2>

            <div className="space-y-3">
              <Field label="Mantenimiento" required>
                <select value={form.schedule_id} onChange={(e) => { field("schedule_id", e.target.value); openFor(e.target.value); }} className="input">
                  <option value="">Seleccioná...</option>
                  {schedules.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.equipos?.code} — {s.equipos?.name} ({s.maintenance_type})</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Estado">
                  <select value={form.execution_status} onChange={(e) => field("execution_status", e.target.value)} className="input">
                    <option value="completado">Completado</option>
                    <option value="parcial">Parcial</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </Field>
                <Field label="Duración (horas)">
                  <input type="number" min="0" step="0.5" value={form.duration_hours}
                    onChange={(e) => field("duration_hours", e.target.value)} placeholder="—" className="input" />
                </Field>
              </div>

              <Field label="Fecha y hora">
                <input type="datetime-local" value={form.executed_at}
                  onChange={(e) => field("executed_at", e.target.value)} className="input" />
              </Field>

              {form.execution_status === "completado" && (
                <Field label="Próxima fecha (opcional — se calcula automáticamente)">
                  <input type="date" value={form.next_date_override}
                    onChange={(e) => field("next_date_override", e.target.value)} className="input" />
                </Field>
              )}

              {checklist?.items?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">{checklist.name}</p>
                  {checklist.items.map((item: any) => (
                    <div key={item.id} className="rounded-lg border border-gray-200 p-3 space-y-1">
                      <p className="text-sm text-gray-800">
                        {item.label}
                        {item.required && <span className="text-red-500 ml-1">*</span>}
                      </p>
                      {item.type === "check" && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox"
                            checked={!!checklistResponses[item.id]}
                            onChange={(e) => setChecklistResponses((r) => ({ ...r, [item.id]: e.target.checked }))}
                            className="rounded" />
                          <span className="text-xs text-gray-500">Verificado</span>
                        </label>
                      )}
                      {item.type === "number" && (
                        <div className="flex items-center gap-2">
                          <input type="number" value={checklistResponses[item.id] ?? ""}
                            onChange={(e) => setChecklistResponses((r) => ({ ...r, [item.id]: e.target.value }))}
                            className="input w-32" placeholder="0" />
                          {item.unit && <span className="text-xs text-gray-500">{item.unit}</span>}
                        </div>
                      )}
                      {item.type === "text" && (
                        <textarea rows={2} value={checklistResponses[item.id] ?? ""}
                          onChange={(e) => setChecklistResponses((r) => ({ ...r, [item.id]: e.target.value }))}
                          className="input resize-none" />
                      )}
                      {item.type === "photo" && (
                        <p className="text-xs text-gray-400">Usá la sección de fotos abajo.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <Field label="Observaciones">
                <textarea value={form.observations} onChange={(e) => field("observations", e.target.value)}
                  rows={3} className="input resize-none" placeholder="Detalle de lo realizado..." />
              </Field>

              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-600">Fotos (máx. 5)</p>
                {photoPreview.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {photoPreview.map((src, i) => (
                      <div key={i} className="relative">
                        <img src={src} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                        <button onClick={() => removePhoto(i)}
                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center leading-none">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {photos.length < 5 && (
                  <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors w-fit">
                    <span>📷 Agregar foto</span>
                    <input type="file" accept="image/*" multiple capture="environment" className="hidden"
                      onChange={(e) => handlePhotos(e.target.files)} />
                  </label>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={saving || uploadingPhotos}
                className="btn-primary disabled:opacity-50">
                {uploadingPhotos ? "Subiendo fotos..." : saving ? "Guardando..." : "Guardar"}
              </button>
              <button onClick={() => setShowForm(false)}
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
