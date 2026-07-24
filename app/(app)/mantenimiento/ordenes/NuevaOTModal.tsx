"use client";

import { useState } from "react";

const ESPECIALIDADES = ["MECÁNICO", "ELÉCTRICO", "INSTRUMENTACIÓN", "CIVIL", "OTRO"];
const TIPOS = ["PROGRAMADO", "CORRECTIVO", "PREDICTIVO", "MEJORA"];
const QUIEN_OPTIONS = ["INTERNO", "CONTRATADO", "MIXTO"];
const PRIORIDADES = ["ALTA", "MEDIA", "BAJA"];
const ESTADOS_OT = [
  { value: "POR_HACER",  label: "Por hacer" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "REALIZADO",  label: "Realizado" },
  { value: "ATRASADO",   label: "Atrasado" },
];

export default function NuevaOTModal({ sectores, equipos, onClose, onCreated }: {
  sectores: any[];
  equipos: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  const [form, setForm] = useState({
    equipment_id:   "",
    sector_id:      "",
    especialidad:   "",
    tipo:           "CORRECTIVO",
    quien:          "INTERNO",
    descripcion:    "",
    repuesto:       "",
    fecha:          new Date().toISOString().slice(0, 10),
    fecha_ejecucion: "",
    fecha_cierre:   "",
    estado:         "POR_HACER",
    contratista:    "",
    horas:          "",
    operario_1:     "",
    operario_2:     "",
    operario_3:     "",
    prioridad:      "MEDIA",
  });

  function f(key: string, value: string) {
    setForm(p => {
      const next: any = { ...p, [key]: value };
      if (key === "equipment_id" && value) {
        const eq = equipos.find((e: any) => e.id === value);
        if (eq) next.sector_id = eq.sector_id ?? "";
      }
      return next;
    });
  }

  const filteredEquip = form.sector_id
    ? equipos.filter((e: any) => e.sector_id === form.sector_id)
    : equipos;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descripcion.trim()) { setError("La descripción es requerida."); return; }
    setSaving(true); setError("");

    const eq = equipos.find((eq: any) => eq.id === form.equipment_id);
    const sec = sectores.find((s: any) => s.id === form.sector_id);

    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        horas:       form.horas ? Number(form.horas) : null,
        equipo_raw:  eq ? `${eq.code} – ${eq.name}` : null,
        equipo_code: eq?.code ?? null,
        sector_raw:  sec?.nombre ?? null,
        equipment_id: form.equipment_id || null,
        sector_id:   form.sector_id || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Error al crear"); setSaving(false); return; }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Nueva Orden de Trabajo</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <F label="Sector">
              <select value={form.sector_id} onChange={e => f("sector_id", e.target.value)} className="input">
                <option value="">— Todos —</option>
                {sectores.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.empresas?.nombre ?? "Transversal"} · {s.nombre}</option>
                ))}
              </select>
            </F>
            <F label="Equipo">
              <select value={form.equipment_id} onChange={e => f("equipment_id", e.target.value)} className="input">
                <option value="">— Sin asignar —</option>
                {filteredEquip.map((eq: any) => (
                  <option key={eq.id} value={eq.id}>{eq.code} – {eq.name}</option>
                ))}
              </select>
            </F>
          </div>

          <F label="Descripción del trabajo" required>
            <textarea value={form.descripcion} onChange={e => f("descripcion", e.target.value)}
              rows={3} className="input resize-none" placeholder="Describí el trabajo a realizar..." />
          </F>

          <div className="grid grid-cols-3 gap-4">
            <F label="Especialidad">
              <select value={form.especialidad} onChange={e => f("especialidad", e.target.value)} className="input">
                <option value="">—</option>
                {ESPECIALIDADES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </F>
            <F label="Tipo">
              <select value={form.tipo} onChange={e => f("tipo", e.target.value)} className="input">
                {TIPOS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </F>
            <F label="Quién realiza">
              <select value={form.quien} onChange={e => f("quien", e.target.value)} className="input">
                {QUIEN_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </F>
          </div>

          <F label="Repuesto utilizado">
            <input value={form.repuesto} onChange={e => f("repuesto", e.target.value)}
              className="input" placeholder="Ej: Rodamiento 32222..." />
          </F>

          <div className="grid grid-cols-3 gap-4">
            <F label="Fecha creación">
              <input type="date" value={form.fecha} onChange={e => f("fecha", e.target.value)} className="input" />
            </F>
            <F label="Fecha ejecución">
              <input type="date" value={form.fecha_ejecucion} onChange={e => f("fecha_ejecucion", e.target.value)} className="input" />
            </F>
            <F label="Fecha cierre">
              <input type="date" value={form.fecha_cierre} onChange={e => f("fecha_cierre", e.target.value)} className="input" />
            </F>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <F label="Estado inicial">
              <select value={form.estado} onChange={e => f("estado", e.target.value)} className="input">
                {ESTADOS_OT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </F>
            <F label="Prioridad">
              <select value={form.prioridad} onChange={e => f("prioridad", e.target.value)} className="input">
                {PRIORIDADES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </F>
            <F label="Horas estimadas">
              <input type="number" value={form.horas} onChange={e => f("horas", e.target.value)}
                className="input" placeholder="—" min={0} step={0.5} />
            </F>
          </div>

          {(form.quien === "CONTRATADO" || form.quien === "MIXTO") && (
            <F label="Contratista">
              <input value={form.contratista} onChange={e => f("contratista", e.target.value)} className="input" />
            </F>
          )}
          <div className="grid grid-cols-3 gap-4">
            <F label="Operario 1">
              <input value={form.operario_1} onChange={e => f("operario_1", e.target.value)} className="input" placeholder="—" />
            </F>
            <F label="Operario 2">
              <input value={form.operario_2} onChange={e => f("operario_2", e.target.value)} className="input" placeholder="—" />
            </F>
            <F label="Operario 3">
              <input value={form.operario_3} onChange={e => f("operario_3", e.target.value)} className="input" placeholder="—" />
            </F>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1 border-t border-gray-100">
            <button type="submit" disabled={saving}
              className="btn-primary disabled:opacity-50">
              {saving ? "Guardando..." : "Crear OT"}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function F({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
