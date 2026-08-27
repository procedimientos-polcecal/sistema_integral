"use client";

import { useState } from "react";
import { moneda } from "@/lib/compras/constants";
import SelectorProveedor from "./SelectorProveedor";

/**
 * Aprobar una compra sin elegir un presupuesto.
 *
 * Hay compras que no se comparan —proveedor único, urgencia, monto menor— y
 * exigirles una comparativa es exigir un trámite vacío. El aviso está para que
 * el que aprueba sepa qué está haciendo, pero no traba: quien decide el gasto
 * es él, no el sistema.
 *
 * El proveedor y el costo son opcionales a propósito. Se puede aprobar antes de
 * tener el precio firme; cargarlos es obligatorio recién al registrar el
 * pedido, que es cuando la compra ya se hizo.
 *
 * Lo usan las dos pantallas donde se aprueba: la bandeja, donde va inline, y el
 * listado, donde va dentro de un diálogo.
 */
export default function AprobarSinComparativa({
  proveedores, presupuestosSinMirar, aprobando, onAprobar, onCancelar,
}: {
  proveedores: { id: string; nombre: string }[];
  /** Cuántos presupuestos hay cargados y sin elegir. 0 = no hay comparativa. */
  presupuestosSinMirar: number;
  aprobando: boolean;
  onAprobar: (datos: { proveedor_id?: string; costo_iva?: number }) => void;
  /** Si se pasa, se muestra el botón de cancelar. La bandeja no lo necesita. */
  onCancelar?: () => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [costoIva, setCostoIva] = useState("");

  const costo = costoIva.trim() === "" ? null : Number(costoIva);
  const costoInvalido = costo !== null && (isNaN(costo) || costo < 0);

  function aprobar() {
    onAprobar({
      ...(proveedorId ? { proveedor_id: proveedorId } : {}),
      ...(costo !== null && !costoInvalido ? { costo_iva: costo } : {}),
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
        {presupuestosSinMirar > 0 ? (
          <p>
            Hay {presupuestosSinMirar} presupuesto{presupuestosSinMirar === 1 ? "" : "s"} cargado
            {presupuestosSinMirar === 1 ? "" : "s"} que no estás eligiendo. La compra va a quedar
            aprobada sin comparativa.
          </p>
        ) : (
          <p>
            No hay presupuestos cargados. La compra va a quedar aprobada sin comparativa.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Proveedor
          </span>
          <SelectorProveedor
            proveedores={proveedores}
            valor={proveedorId}
            onCambio={setProveedorId}
            placeholder="Si ya se sabe…"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Costo + IVA
          </span>
          <input
            type="number" step="0.01" min="0"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={costoIva}
            onChange={(e) => setCostoIva(e.target.value)}
            placeholder="Si ya se sabe…"
          />
        </label>
      </div>

      <p className="text-xs text-slate-500">
        Los dos son opcionales: si todavía no están firmes, se cargan al registrar el pedido.
        {costo !== null && !costoInvalido && costo > 0 && (
          <> Va a quedar en <strong className="font-mono">{moneda(costo)}</strong>.</>
        )}
      </p>

      <div className="flex justify-end gap-2">
        {onCancelar && (
          <button
            onClick={onCancelar}
            disabled={aprobando}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        )}
        <button
          onClick={aprobar}
          disabled={aprobando || costoInvalido}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
        >
          {aprobando ? "Aprobando…" : "Aprobar sin comparativa"}
        </button>
      </div>
    </div>
  );
}
