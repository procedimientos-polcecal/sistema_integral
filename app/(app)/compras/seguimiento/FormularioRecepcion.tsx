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
  /**
   * Se llama SIEMPRE que el guardado sale bien, con el aviso de la planilla
   * si vino uno (o `null` si no). El formulario no decide qué hacer con eso
   * —cerrar, refrescar, dónde mostrarlo—: lo decide quien lo puso en pantalla,
   * porque cada uno lo hace distinto y quedarse con el aviso acá lo pierde
   * apenas el padre cierra o desmonta este formulario.
   */
  alGuardar: (avisoSheets: string | null) => void;
}) {
  const [campos, setCampos] = useState({
    cantidad_comprada: String(requerimiento.cantidad_comprada ?? requerimiento.cantidad ?? ""),
    cantidad_recibida: requerimiento.cantidad_recibida !== null ? String(requerimiento.cantidad_recibida) : "",
    fecha_estimada_recepcion: requerimiento.fecha_estimada_recepcion ?? "",
    fecha_recepcion: requerimiento.fecha_recepcion ?? "",
    cumplio_compras: requerimiento.cumplio_compras ?? ("" as Cumplio | ""),
    cumplio_proveedor: requerimiento.cumplio_proveedor ?? ("" as Cumplio | ""),
  });
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
        // La fecha de recepción es lo que define el estado, en los dos
        // sentidos: ponerla lo da por recibido y borrarla lo devuelve a la
        // espera. Sólo agregar la clave cuando había fecha dejaba un RI
        // RECIBIDO sin fecha de recepción, en la solapa equivocada y sin forma
        // de sacarlo de ahí. El formulario sólo se muestra en PEDIDO o
        // RECIBIDO, así que esto no puede pisar ningún otro estado.
        estado_compra: campos.fecha_recepcion ? "RECIBIDO" : "PEDIDO",
      }),
    });
    const cuerpo = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(cuerpo.error ?? "No se pudo guardar la recepción.");
      return;
    }

    // El cambio ya está guardado: de acá para arriba no es decisión de este
    // formulario. Quien lo puso en pantalla sabe si cierra, si refresca y
    // dónde mostrar el aviso — quedarse con el aviso acá lo pierde apenas el
    // padre cierra o desmonta este formulario.
    alGuardar(cuerpo.aviso_sheets ?? null);
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
