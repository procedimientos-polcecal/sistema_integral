"use client";

import { useState } from "react";
import { comoLeLlego, ETIQUETA_CUMPLIO } from "@/lib/compras/seguimiento";
import type { RequerimientoConRelaciones, Cumplio } from "@/lib/compras/types";

const OPCIONES: Cumplio[] = ["SI", "MAS_O_MENOS", "NO"];

/**
 * El único formulario que carga una recepción.
 *
 * Lo usan la lista de seguimiento y la ficha del RI. Vive acá, aparte de las
 * dos, porque dos formularios que escriben los mismos campos terminan
 * diciendo cosas distintas.
 */
export default function FormularioRecepcion({
  requerimiento,
  alGuardar,
}: {
  requerimiento: RequerimientoConRelaciones;
  alGuardar: () => void;
}) {
  const [campos, setCampos] = useState({
    cantidad_comprada: String(requerimiento.cantidad_comprada ?? requerimiento.cantidad ?? ""),
    cantidad_recibida: requerimiento.cantidad_recibida !== null ? String(requerimiento.cantidad_recibida) : "",
    fecha_estimada_recepcion: requerimiento.fecha_estimada_recepcion ?? "",
    fecha_recepcion: requerimiento.fecha_recepcion ?? "",
    cumplio_compras: requerimiento.cumplio_compras ?? ("" as Cumplio | ""),
    cumplio_proveedor: requerimiento.cumplio_proveedor ?? ("" as Cumplio | ""),
  });
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // El dato duro se recalcula con lo que hay escrito ahora, no con lo
  // guardado: la idea es que la persona vea "llegó 9 días tarde" mientras
  // elige el juicio, no después de guardarlo.
  const dato = comoLeLlego({
    fecha_estimada_recepcion: campos.fecha_estimada_recepcion || null,
    fecha_recepcion: campos.fecha_recepcion || null,
    cantidad: requerimiento.cantidad,
    cantidad_comprada: campos.cantidad_comprada === "" ? null : Number(campos.cantidad_comprada),
    cantidad_recibida: campos.cantidad_recibida === "" ? null : Number(campos.cantidad_recibida),
  });

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    setError(null);
    const res = await fetch(`/api/compras/requerimientos/${requerimiento.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cantidad_comprada: campos.cantidad_comprada === "" ? null : Number(campos.cantidad_comprada),
        cantidad_recibida: campos.cantidad_recibida === "" ? null : Number(campos.cantidad_recibida),
        fecha_estimada_recepcion: campos.fecha_estimada_recepcion || null,
        fecha_recepcion: campos.fecha_recepcion || null,
        cumplio_compras: campos.cumplio_compras || null,
        cumplio_proveedor: campos.cumplio_proveedor || null,
        // Con fecha de recepción el RI está recibido. Sin ella sigue esperando.
        ...(campos.fecha_recepcion ? { estado_compra: "RECIBIDO" } : {}),
      }),
    });
    const cuerpo = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(cuerpo.error ?? "No se pudo guardar la recepción.");
      return;
    }

    // Si la planilla rechazó algo, se dice y ACÁ se queda: `alGuardar` puede
    // cerrar o desmontar este formulario (la lista lo hace), y eso se llevaría
    // el aviso antes de que alguien lo lea. El cambio ya está guardado en la
    // base — lo que falta es que la persona vea que la planilla no lo tiene.
    if (cuerpo.aviso_sheets) {
      setAviso(cuerpo.aviso_sheets);
      return;
    }
    alGuardar();
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); guardar(); }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Cantidad comprada">
          <input
            type="number" step="0.01" min="0"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={campos.cantidad_comprada}
            onChange={(e) => setCampos({ ...campos, cantidad_comprada: e.target.value })}
          />
        </Campo>
        <Campo label="Cantidad recibida">
          <input
            type="number" step="0.01" min="0"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={campos.cantidad_recibida}
            onChange={(e) => setCampos({ ...campos, cantidad_recibida: e.target.value })}
          />
        </Campo>
        <Campo label="Fecha estimada de recepción">
          <input
            type="date"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={campos.fecha_estimada_recepcion}
            onChange={(e) => setCampos({ ...campos, fecha_estimada_recepcion: e.target.value })}
          />
        </Campo>
        <Campo label="Fecha de recepción">
          <input
            type="date"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={campos.fecha_recepcion}
            onChange={(e) => setCampos({ ...campos, fecha_recepcion: e.target.value })}
          />
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="¿Cumplió Compras?">
          {dato.demora && <p className="mb-1 text-xs text-slate-500">{dato.demora}</p>}
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={campos.cumplio_compras}
            onChange={(e) => setCampos({ ...campos, cumplio_compras: e.target.value as Cumplio })}
          >
            <option value="">Sin responder</option>
            {OPCIONES.map((o) => <option key={o} value={o}>{ETIQUETA_CUMPLIO[o]}</option>)}
          </select>
        </Campo>
        <Campo label="¿Cumplió el proveedor?">
          {dato.cantidad && <p className="mb-1 text-xs text-slate-500">{dato.cantidad}</p>}
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={campos.cumplio_proveedor}
            onChange={(e) => setCampos({ ...campos, cumplio_proveedor: e.target.value as Cumplio })}
          >
            <option value="">Sin responder</option>
            {OPCIONES.map((o) => <option key={o} value={o}>{ETIQUETA_CUMPLIO[o]}</option>)}
          </select>
        </Campo>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {aviso && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {aviso}
        </div>
      )}

      <button
        type="submit"
        disabled={guardando}
        className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
      >
        {guardando ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
