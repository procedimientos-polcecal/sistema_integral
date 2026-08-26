"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { monto } from "@/lib/mantenimiento/planilla";
import { monedaExacta } from "@/lib/compras/constants";

/**
 * Cargar una cotización a la comparativa de una OS.
 *
 * Se escribe acá y va a la planilla, que sigue siendo la base: la idea es no
 * tener que abrir el Sheets para sumar un presupuesto que llegó por mail.
 *
 * El proveedor se elige de la lista de contratistas en vez de escribirse. En
 * las planillas hay cinco maneras de escribir "Don Alfredo" justamente porque
 * cada uno lo tipeaba de nuevo.
 */
export default function CotizacionForm({
  osNumber, sector, onCargada, onCerrar,
}: {
  osNumber: number;
  sector: string | null;
  onCargada: () => void;
  onCerrar: () => void;
}) {
  const [contratistas, setContratistas] = useState<{ id: string; nombre: string }[]>([]);
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const [campos, setCampos] = useState({
    proveedor: "",
    precio_unitario: "",
    iva: "21",
    precio_total: "",
    vigencia_hasta: "",
    plazos: "",
    condiciones_pago: "",
    otras_especificaciones: "",
  });

  const set = (clave: string, valor: string) => setCampos((c) => ({ ...c, [clave]: valor }));

  const traer = useCallback(async () => {
    const res = await fetch("/api/mantenimiento/proveedores");
    if (res.ok) setContratistas((await res.json()).data ?? []);
  }, []);
  useEffect(() => { traer(); }, [traer]);

  // El total sugerido, que es lo que hace la planilla con su fórmula. Se puede
  // pisar: a veces el proveedor cotiza un total que no sale de esa cuenta.
  const totalSugerido = useMemo(() => {
    const unitario = monto(campos.precio_unitario);
    const iva = monto(campos.iva);
    if (unitario === null) return null;
    return Math.round(unitario * (1 + (iva ?? 0) / 100) * 100) / 100;
  }, [campos.precio_unitario, campos.iva]);

  async function guardar() {
    if (!campos.proveedor.trim()) { setError("Falta el proveedor."); return; }

    const unitario = monto(campos.precio_unitario);
    if (unitario === null) { setError("Falta el precio unitario."); return; }

    setGuardando(true);
    setError("");

    const total = monto(campos.precio_total) ?? totalSugerido;
    const iva = monto(campos.iva);

    const res = await fetch("/api/mantenimiento/comparativas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        os_number: osNumber,
        sector,
        proveedor: campos.proveedor.trim(),
        // A la planilla van números, no lo que se tipeó: sus fórmulas los usan.
        precio_unitario: String(unitario),
        precio_total: total === null ? "" : String(total),
        // La planilla guarda el IVA como fracción y lo muestra como "21%".
        iva: iva === null ? null : iva / 100,
        vigencia_hasta: campos.vigencia_hasta || null,
        plazos: campos.plazos.trim(),
        condiciones_pago: campos.condiciones_pago.trim(),
        otras_especificaciones: campos.otras_especificaciones.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo cargar."); return; }
    onCargada();
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-slate-800">Cargar una cotización</h4>
        <button onClick={onCerrar} className="text-xs text-slate-500 hover:text-slate-700">
          Cancelar
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Proveedor</span>
          {nuevoProveedor || contratistas.length === 0 ? (
            <div className="flex gap-1">
              <input
                value={campos.proveedor}
                onChange={(e) => set("proveedor", e.target.value)}
                placeholder="Nombre del proveedor"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {contratistas.length > 0 && (
                <button
                  onClick={() => { setNuevoProveedor(false); set("proveedor", ""); }}
                  className="shrink-0 rounded-lg border border-slate-300 px-2 text-xs text-slate-600"
                  title="Elegir de la lista"
                >Lista</button>
              )}
            </div>
          ) : (
            <select
              value={campos.proveedor}
              onChange={(e) => {
                if (e.target.value === "__nuevo") { setNuevoProveedor(true); set("proveedor", ""); }
                else set("proveedor", e.target.value);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Elegir…</option>
              {contratistas.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              <option value="__nuevo">Otro, no está en la lista…</option>
            </select>
          )}
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Vigencia hasta</span>
          <input
            type="date"
            value={campos.vigencia_hasta}
            onChange={(e) => set("vigencia_hasta", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Precio unitario</span>
          <input
            value={campos.precio_unitario}
            onChange={(e) => set("precio_unitario", e.target.value)}
            inputMode="decimal"
            placeholder="1.972.500"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">IVA (%)</span>
          <input
            value={campos.iva}
            onChange={(e) => set("iva", e.target.value)}
            inputMode="decimal"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-xs font-medium text-slate-600">
            Precio total
            {totalSugerido !== null && !campos.precio_total && (
              <span className="ml-1 font-normal text-slate-400">
                — con IVA da {monedaExacta(totalSugerido)}
              </span>
            )}
          </span>
          <input
            value={campos.precio_total}
            onChange={(e) => set("precio_total", e.target.value)}
            inputMode="decimal"
            placeholder={totalSugerido !== null ? String(totalSugerido) : "El total cotizado"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Plazo de entrega</span>
          <input
            value={campos.plazos}
            onChange={(e) => set("plazos", e.target.value)}
            placeholder="15 días"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Condiciones de pago</span>
          <input
            value={campos.condiciones_pago}
            onChange={(e) => set("condiciones_pago", e.target.value)}
            placeholder="30 días F.F"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-xs font-medium text-slate-600">Otras especificaciones</span>
          <input
            value={campos.otras_especificaciones}
            onChange={(e) => set("otras_especificaciones", e.target.value)}
            placeholder="Precio en dólares, incluye flete…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-xs text-slate-500">
        Se escribe primero en la planilla de comparativas, que es la base, y después acá.
      </p>

      <button
        onClick={guardar}
        disabled={guardando}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {guardando ? "Cargando…" : "Cargar la cotización"}
      </button>
    </div>
  );
}
