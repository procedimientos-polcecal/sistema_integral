"use client";

import { useState } from "react";
import { PRIORIDADES, PRIORIDAD_LABELS } from "@/lib/compras/constants";

type Opcion = { id: string; nombre: string };

/**
 * Alta de un requerimiento. Es el formulario que hoy vive en Google Forms, así
 * que se mantiene igual de corto: sólo descripción y área son obligatorias.
 */
export default function NuevoRequerimientoModal({
  areas, empresas, ubicaciones, onClose, onSaved,
}: {
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [descripcion, setDescripcion] = useState("");
  const [areaId, setAreaId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [codigo, setCodigo] = useState("");
  const [fechaNecesidad, setFechaNecesidad] = useState("");
  const [prioridad, setPrioridad] = useState("NORMAL");
  const [empresaId, setEmpresaId] = useState("");   // "" = Ambas
  const [detalle, setDetalle] = useState("");
  const [imagenUrl, setImagenUrl] = useState("");

  const [ubicacionId, setUbicacionId] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");

    const res = await fetch("/api/compras/requerimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descripcion: descripcion.trim(),
        area_id: areaId || null,
        cantidad: cantidad ? Number(cantidad) : null,
        codigo: codigo.trim() || null,
        fecha_necesidad: fechaNecesidad || null,
        prioridad,
        empresa_id: empresaId || null,
        detalle_extra: detalle.trim() || null,
        imagen_url: imagenUrl.trim() || null,
        ubicacion_id: ubicacionId || null,
      }),
    });

    setGuardando(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo guardar el requerimiento.");
      return;
    }
    onSaved();
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-10 w-full max-w-2xl rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Nuevo requerimiento interno</h2>
          <p className="text-sm text-slate-500">
            El N° de RI se asigna solo y el pedido queda pendiente de aprobación.
          </p>
        </div>

        <form onSubmit={enviar} className="space-y-4 px-6 py-5">
          <Campo label="Qué se necesita" requerido>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              required
              autoFocus
              placeholder="Correa B58, rodamiento 6309, bolsas de papel…"
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Área que pide" requerido>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
                required
              >
                <option value="">Elegir área…</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </Campo>

            <Campo label="Cantidad">
              <input
                type="number" min="0" step="any"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </Campo>

            <Campo label="Código de artículo">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Opcional"
              />
            </Campo>

            <Campo label="Para cuándo se necesita">
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={fechaNecesidad}
                onChange={(e) => setFechaNecesidad(e.target.value)}
              />
            </Campo>

            <Campo label="Prioridad">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value)}
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>{PRIORIDAD_LABELS[p].label}</option>
                ))}
              </select>
            </Campo>

            <Campo label="Empresa que paga">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={empresaId}
                onChange={(e) => setEmpresaId(e.target.value)}
              >
                <option value="">Ambas</option>
                {empresas.map((e2) => <option key={e2.id} value={e2.id}>{e2.nombre}</option>)}
              </select>
            </Campo>
          </div>

          {/* Dónde se necesita */}
          <Campo label="Dónde se necesita">
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={ubicacionId}
              onChange={(e) => setUbicacionId(e.target.value)}
            >
              <option value="">Sin especificar</option>
              {ubicaciones.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              ¿Falta un lugar en la lista? Pedile a Compras que lo agregue, así todos
              lo escriben igual y se puede filtrar por ubicación.
            </p>
          </Campo>

          <Campo label="Detalle extra">
            <textarea
              rows={3}
              className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder="Medidas, marca, proveedor sugerido, para qué se usa…"
            />
          </Campo>

          <Campo label="Enlace a una foto o plano">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={imagenUrl}
              onChange={(e) => setImagenUrl(e.target.value)}
              placeholder="https://drive.google.com/…"
            />
          </Campo>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando || !descripcion.trim() || !areaId}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Crear requerimiento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Campo({
  label, requerido, children,
}: {
  label: string;
  requerido?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}{requerido && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
