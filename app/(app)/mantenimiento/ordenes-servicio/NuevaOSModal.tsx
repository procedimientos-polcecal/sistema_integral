"use client";

import { useState } from "react";
import { OS_PESTANAS } from "@/lib/mantenimiento/os";

/**
 * Una orden de servicio nueva.
 *
 * Se carga acá y se agrega a la planilla, que sigue siendo la base: si la
 * escritura falla la OS igual queda en la app, y se avisa.
 */
export default function NuevaOSModal({
  areas, sectores, onCerrar, onCreada,
}: {
  areas: string[];
  sectores: { id: string; nombre: string }[];
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Las áreas que ya usa la planilla primero; el resto de las pestañas después.
  const opcionesArea = [...new Set([...areas, ...OS_PESTANAS.filter((p) => p !== "SERVICIOS")])];

  const [campos, setCampos] = useState({
    area: opcionesArea[0] ?? "MANTENIMIENTO",
    sector_id: "",
    sector_raw: "",
    equipo_raw: "",
    descripcion: "",
    detalle_extra: "",
    prioridad: "",
    empresa: "",
  });

  const set = (clave: string, valor: string) =>
    setCampos((c) => ({ ...c, [clave]: valor }));

  async function crear() {
    if (!campos.descripcion.trim()) { setError("Falta decir qué se pide."); return; }
    setGuardando(true);
    setError("");

    const sector = sectores.find((s) => s.id === campos.sector_id);
    const res = await fetch("/api/mantenimiento/ordenes-servicio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...campos,
        sector_id: campos.sector_id || null,
        sector_raw: sector?.nombre ?? campos.sector_raw,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo crear."); return; }

    if (body.planilla_error) {
      // La OS existe: lo que falló es la planilla, y hay que decirlo entero.
      setAviso(
        `Se creó la OS #${body.os_number}, pero no se pudo agregar a la planilla: ${body.planilla_error}`
      );
      return;
    }
    onCreada();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Nueva orden de servicio</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Un trabajo que se le pide a un tercero. El número lo asigna el sistema.
            </p>
          </div>
          <button onClick={onCerrar} className="text-xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {aviso && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p>{aviso}</p>
            <button onClick={onCreada} className="font-semibold underline">Entendido</button>
          </div>
        )}

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Qué se pide</span>
          <textarea
            value={campos.descripcion}
            onChange={(e) => set("descripcion", e.target.value)}
            rows={2}
            placeholder="Reparación del reductor, 20 hs de mecánico…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Área</span>
            <select
              value={campos.area}
              onChange={(e) => set("area", e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {opcionesArea.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Sector</span>
            <select
              value={campos.sector_id}
              onChange={(e) => set("sector_id", e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin sector</option>
              {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Equipo</span>
            <input
              value={campos.equipo_raw}
              onChange={(e) => set("equipo_raw", e.target.value)}
              placeholder="PO-B1-27 – Cadena de arrastre"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Prioridad</span>
            <select
              value={campos.prioridad}
              onChange={(e) => set("prioridad", e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin definir</option>
              <option value="ALTA">Alta</option>
              <option value="MEDIA">Media</option>
              <option value="BAJA">Baja</option>
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Detalle extra</span>
          <input
            value={campos.detalle_extra}
            onChange={(e) => set("detalle_extra", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="flex gap-2 pt-1">
          <button
            onClick={crear}
            disabled={guardando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Creando…" : "Crear"}
          </button>
          <button
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
