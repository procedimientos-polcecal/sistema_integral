"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Carbonillero } from "@/lib/calidad/types";

/**
 * El catálogo de carbonilleros.
 *
 * **Se identifica por el partner de Odoo y no por el proveedor del núcleo**,
 * porque es lo que el dato realmente trae: la línea de compra llega con un
 * `partner_id`. Exigir que exista primero en `proveedores` con CUIT vinculado
 * pondría entre el camión y el stock una tarea administrativa que hace un mes no
 * se hace.
 *
 * Por eso la columna **En el núcleo** dice `falta` en vez de esconderlo: es una
 * deuda real —sin ese enganche el carbón no se cruza con Compras ni con
 * Facturación— y se mira acá.
 */
export default function CarbonillerosClient({
  carbonilleros,
  sinDeclarar,
  empresas,
  proveedores,
}: {
  carbonilleros: Carbonillero[];
  sinDeclarar: { id: number; nombre: string }[];
  empresas: { id: string; nombre: string }[];
  proveedores: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<Partial<Carbonillero> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sinNucleo = carbonilleros.filter((c) => !c.proveedor_id).length;

  async function guardar(c: Partial<Carbonillero>) {
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/calidad/carbonilleros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar.");
      return;
    }
    setEditando(null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Carbonilleros</h1>
          <p className="text-sm text-slate-500">
            {carbonilleros.length} declarados
            {sinNucleo > 0 && ` · ${sinNucleo} sin enganchar al catálogo del núcleo`}
          </p>
        </div>
        <button
          onClick={() =>
            setEditando({ carbon: "vegetal", activo: true, empresa_id: empresas[0]?.id })
          }
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
        >
          Declarar uno
        </button>
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {sinDeclarar.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-bold text-amber-900">
            Trajeron carbonilla y no están declarados
          </h2>
          <ul className="mt-2 space-y-1">
            {sinDeclarar.map((p) => (
              <li key={p.id} className="text-sm text-amber-900">
                {p.nombre} <span className="font-mono text-xs">({p.id})</span>{" "}
                <button
                  onClick={() =>
                    setEditando({
                      odoo_partner_id: p.id,
                      nombre_planilla: p.nombre,
                      carbon: "vegetal",
                      activo: true,
                      empresa_id: empresas[0]?.id,
                    })
                  }
                  className="ml-1 underline"
                >
                  declarar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editando && (
        <form
          className="space-y-3 rounded-lg border border-slate-300 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            guardar(editando);
          }}
        >
          <p className="text-sm font-bold text-slate-900">
            {editando.id ? "Editar carbonillero" : "Declarar carbonillero"}
          </p>

          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-slate-600">
              Partner de Odoo
              <input
                value={editando.odoo_partner_id ?? ""}
                onChange={(e) =>
                  setEditando({ ...editando, odoo_partner_id: Number(e.target.value) })
                }
                required
                inputMode="numeric"
                className="mt-0.5 block w-28 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="text-xs text-slate-600">
              Empresa
              <select
                value={editando.empresa_id ?? ""}
                onChange={(e) => setEditando({ ...editando, empresa_id: e.target.value })}
                required
                className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {empresas.map((e2) => (
                  <option key={e2.id} value={e2.id}>
                    {e2.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Carbón
              <select
                value={editando.carbon ?? "vegetal"}
                onChange={(e) =>
                  setEditando({ ...editando, carbon: e.target.value as "vegetal" | "residual" })
                }
                className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="vegetal">Vegetal</option>
                <option value="residual">Residual</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Código de planilla
              <input
                value={editando.codigo_planilla ?? ""}
                onChange={(e) => setEditando({ ...editando, codigo_planilla: e.target.value })}
                required
                placeholder="00003"
                className="mt-0.5 block w-24 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Nombre de planilla
              <input
                value={editando.nombre_planilla ?? ""}
                onChange={(e) => setEditando({ ...editando, nombre_planilla: e.target.value })}
                required
                className="mt-0.5 block w-64 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Proveedor del núcleo (opcional)
              <select
                value={editando.proveedor_id ?? ""}
                onChange={(e) =>
                  setEditando({ ...editando, proveedor_id: e.target.value || null })
                }
                className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">— sin enganchar —</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-500">
            El código y el nombre son <strong>los que el libro ya usa</strong>, no la razón social
            de Odoo: la planilla la siguen leyendo personas que tienen un año de historia escrito
            así.
          </p>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={guardando}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditando(null)}
              className="text-sm text-slate-600 underline"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre en la planilla</th>
              <th className="px-3 py-2">Carbón</th>
              <th className="px-3 py-2">Partner de Odoo</th>
              <th className="px-3 py-2">En el núcleo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {carbonilleros.map((c) => (
              <tr key={c.id} className={c.activo ? undefined : "opacity-50"}>
                <td className="px-3 py-1.5 font-mono text-slate-600">{c.codigo_planilla}</td>
                <td className="px-3 py-1.5 text-slate-900">{c.nombre_planilla}</td>
                <td className="px-3 py-1.5">
                  <span
                    className={
                      c.carbon === "residual"
                        ? "rounded bg-slate-800 px-1.5 py-0.5 text-xs text-white"
                        : "rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                    }
                  >
                    {c.carbon}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                  {c.odoo_partner_id}
                </td>
                <td className="px-3 py-1.5">
                  {c.proveedor_id ? (
                    <span className="text-xs text-slate-500">sí</span>
                  ) : (
                    <span className="text-xs font-semibold text-amber-700">falta</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    onClick={() => setEditando(c)}
                    className="text-xs text-slate-600 underline"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sinNucleo > 0 && (
        <p className="text-xs text-slate-500">
          Los que dicen <strong>falta</strong> funcionan igual para el stock. Lo que no funciona sin
          el enganche es cruzar ese carbón con Compras y con Facturación, y el enganche va por CUIT.
        </p>
      )}
    </div>
  );
}
