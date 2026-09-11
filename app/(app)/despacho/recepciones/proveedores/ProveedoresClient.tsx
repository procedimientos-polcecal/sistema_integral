"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProveedorDeRecepcion } from "@/lib/despacho/types";

interface ProveedorBase {
  id: string;
  nombre: string;
  rubro: string | null;
  cuit: string | null;
}

/**
 * Los proveedores que traen material, y qué se les carga.
 *
 * Dos cosas por proveedor y las dos hay que saberlas de afuera: el **producto de
 * Odoo** —que decide a qué cuenta entra el material— y el **nombre de planilla**
 * —`Bruzzone`, no `BRUZZONE JUAN ALBERTO`—.
 *
 * Y una advertencia que la pantalla muestra sola: sin CUIT no hay vínculo con
 * Odoo, y sin vínculo la recepción no se puede cerrar. De los diez carbonilleros
 * del catálogo, seis no lo tienen.
 */
export default function ProveedoresDeRecepcionClient({
  proveedores,
  config,
  productos,
  errorOdoo,
}: {
  proveedores: ProveedorBase[];
  config: ProveedorDeRecepcion[];
  productos: { id: number; nombre: string }[];
  errorOdoo: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [productoId, setProductoId] = useState("");
  const [nombrePlanilla, setNombrePlanilla] = useState("");
  const [guardando, setGuardando] = useState(false);

  const porProveedor = new Map(config.map((c) => [c.proveedor_id, c]));

  function abrir(p: ProveedorBase) {
    const c = porProveedor.get(p.id);
    setEditando(p.id);
    setProductoId(c ? String(c.odoo_product_id) : "");
    // Por defecto, el nombre del catálogo: es corto y es el que ya se usa.
    setNombrePlanilla(c?.nombre_planilla ?? capitalizar(p.nombre));
    setError("");
  }

  async function guardar(p: ProveedorBase) {
    const producto = productos.find((x) => String(x.id) === productoId);
    if (!producto) {
      setError("Hay que elegir el producto de Odoo.");
      return;
    }
    setGuardando(true);
    const res = await fetch("/api/despacho/recepciones/proveedores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedor_id: p.id,
        odoo_product_id: producto.id,
        odoo_product_nombre: producto.nombre,
        nombre_planilla: nombrePlanilla.trim(),
      }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return;
    }
    setEditando(null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Proveedores de recepción</h1>
        <p className="text-sm text-slate-500">
          Qué producto de Odoo le corresponde a cada uno, y cómo se lo escribe en
          la planilla. Sin esto, sus camiones se pueden pesar pero no cerrar.
        </p>
      </div>

      {errorOdoo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No se pudo leer el catálogo de Odoo, así que no hay productos para
          elegir: {errorOdoo}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {proveedores.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            No hay proveedores con rubro CARBONILLA en el catálogo.
          </p>
        ) : (
          proveedores.map((p) => {
            const c = porProveedor.get(p.id);
            return (
              <div key={p.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{p.nombre}</div>
                    <div className="text-xs text-slate-400">
                      {c ? (
                        <>
                          {c.odoo_product_nombre.trim()} · planilla: {c.nombre_planilla}
                        </>
                      ) : (
                        <span className="text-amber-700">sin configurar</span>
                      )}
                      {!p.cuit && (
                        <span className="ml-2 text-red-700">
                          · sin CUIT: no está enlazado con Odoo y no va a poder cerrar
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => abrir(p)}
                    className="text-sm text-slate-500 underline hover:text-slate-700"
                  >
                    {c ? "Cambiar" : "Configurar"}
                  </button>
                </div>

                {editando === p.id && (
                  <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">Producto de Odoo</span>
                      <select
                        value={productoId}
                        onChange={(e) => setProductoId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="">Elegir…</option>
                        {productos.map((x) => (
                          <option key={x.id} value={x.id}>{x.nombre}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">
                        Cómo se escribe en la planilla
                      </span>
                      <input
                        value={nombrePlanilla}
                        onChange={(e) => setNombrePlanilla(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <button
                        onClick={() => guardar(p)}
                        disabled={guardando}
                        className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {guardando ? "Guardando…" : "Guardar"}
                      </button>
                      <button
                        onClick={() => setEditando(null)}
                        className="text-sm text-slate-500 hover:text-slate-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** `BRUZZONE` se propone como `Bruzzone`, que es como lo escribe el libro. */
function capitalizar(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(" ")
    .map((p) => (p.length > 0 ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}
