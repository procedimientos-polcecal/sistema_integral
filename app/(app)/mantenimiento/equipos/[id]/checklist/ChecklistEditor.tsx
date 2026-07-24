"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type ItemType = "check" | "number" | "text" | "photo";

interface ChecklistItem {
  id: string;
  label: string;
  type: ItemType;
  required: boolean;
  unit?: string;
}

const TYPE_LABELS: Record<ItemType, string> = {
  check:  "✓ Verificación",
  number: "# Valor numérico",
  text:   "T Texto libre",
  photo:  "📷 Foto",
};

export default function ChecklistEditor({ equipo, checklist, canEdit }: {
  equipo: any;
  checklist: any;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ChecklistItem[]>(
    checklist?.items ?? []
  );
  const [name, setName] = useState(checklist?.name ?? "Checklist de mantenimiento");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function addItem() {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: "", type: "check", required: false },
    ]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateItem(id: string, patch: Partial<ChecklistItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function moveItem(idx: number, dir: -1 | 1) {
    const next = [...items];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setItems(next);
  }

  async function save() {
    setSaving(true);
    const supabase = createClient();

    if (checklist?.id) {
      await supabase
        .from("equipos_checklists")
        .update({ items, name })
        .eq("id", checklist.id);
    } else {
      await supabase.from("equipos_checklists").insert({
        equipment_id: equipo.id,
        name,
        items,
        is_active: true,
        version: 1,
      });
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/mantenimiento/equipos/${equipo.id}`} className="text-sm text-gray-400 hover:text-gray-700">
          ← {equipo.code} — {equipo.name}
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Checklist</h1>
        {canEdit && (
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Guardando..." : saved ? "✓ Guardado" : "Guardar"}
          </button>
        )}
      </div>

      {canEdit && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Nombre del checklist</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </div>
      )}

      <div className="space-y-2">
        {items.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400 border border-dashed border-gray-300 rounded-xl">
            {canEdit ? "Agregá ítems al checklist." : "Sin ítems configurados."}
          </div>
        )}
        {items.map((item, idx) => (
          <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-start gap-2">
              {canEdit && (
                <div className="flex flex-col gap-0.5 pt-1">
                  <button onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none">▲</button>
                  <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none">▼</button>
                </div>
              )}
              <div className="flex-1 space-y-2">
                {canEdit ? (
                  <input
                    value={item.label}
                    onChange={(e) => updateItem(item.id, { label: e.target.value })}
                    placeholder="Descripción del ítem..."
                    className="input"
                  />
                ) : (
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  {canEdit ? (
                    <select
                      value={item.type}
                      onChange={(e) => updateItem(item.id, { type: e.target.value as ItemType })}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none"
                    >
                      {Object.entries(TYPE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-gray-500">{TYPE_LABELS[item.type]}</span>
                  )}
                  {item.type === "number" && canEdit && (
                    <input
                      value={item.unit ?? ""}
                      onChange={(e) => updateItem(item.id, { unit: e.target.value })}
                      placeholder="Unidad (ej: °C, rpm)"
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none w-32"
                    />
                  )}
                  {canEdit && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.required}
                        onChange={(e) => updateItem(item.id, { required: e.target.checked })}
                        className="rounded"
                      />
                      Obligatorio
                    </label>
                  )}
                  {item.required && !canEdit && (
                    <span className="text-xs text-red-500">Obligatorio</span>
                  )}
                </div>
              </div>
              {canEdit && (
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors text-sm mt-1"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {canEdit && (
        <button
          onClick={addItem}
          className="w-full rounded-xl border border-dashed border-gray-300 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Agregar ítem
        </button>
      )}
    </div>
  );
}
