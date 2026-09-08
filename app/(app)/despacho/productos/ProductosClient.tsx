"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ENVASES, GRANULOMETRIAS, MATERIALES, separarCodigoYNombre } from "@/lib/despacho/clasificacion";
import type { ProductoDeDespacho } from "@/lib/despacho/types";
import type { SinClasificar } from "./page";

/**
 * Clasificar los productos de Odoo.
 *
 * Los tres campos se eligen de una lista y no se escriben: un material tipeado a
 * mano entra con un typo y aparece como un material nuevo en los filtros del
 * histórico. La base los guarda como texto —un enum de Postgres cuesta una
 * migración sola por valor nuevo, y estas listas van a crecer— así que la
 * validación está en la ruta y la lista, acá.
 *
 * Un producto **no se borra**: las órdenes viejas lo referencian por
 * `odoo_product_id` y perder su clasificación las dejaría sin material. El botón
 * dice "Desactivar" y saca al producto del alta sin tocar su historia.
 */

export default function ProductosClient({
  mapeo,
  sinClasificar,
  productosDeProduccion,
}: {
  mapeo: ProductoDeDespacho[];
  sinClasificar: SinClasificar[];
  productosDeProduccion: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [clasificando, setClasificando] = useState<SinClasificar | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [material, setMaterial] = useState<string>("");
  const [granulometria, setGranulometria] = useState<string>("");
  const [envase, setEnvase] = useState<string>("");
  const [puente, setPuente] = useState<string>("");

  function abrir(p: SinClasificar) {
    setClasificando(p);
    setMaterial("");
    setGranulometria("");
    setEnvase("");
    setPuente("");
    setError("");
  }

  async function guardar() {
    if (!clasificando || clasificando.odoo_product_id === null) return;
    if (!material || !envase) {
      setError("Faltan el material y el envase.");
      return;
    }

    setGuardando(true);
    setError("");
    const { codigo, nombre } = separarCodigoYNombre(clasificando.producto_raw ?? "");
    const res = await fetch("/api/despacho/productos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        odoo_product_id: clasificando.odoo_product_id,
        odoo_default_code: codigo,
        odoo_nombre: nombre ?? clasificando.producto_raw ?? "",
        material,
        granulometria: granulometria || null,
        envase,
        produccion_producto_id: puente || null,
      }),
    });
    setGuardando(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return;
    }
    setClasificando(null);
    router.refresh();
  }

  async function alternarActivo(p: ProductoDeDespacho) {
    setError("");
    const res = await fetch("/api/despacho/productos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, activo: !p.activo }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Productos de Despacho</h1>
        <p className="text-sm text-slate-500">
          Qué material, granulometría y envase es cada producto de Odoo. Los tres
          campos del talonario están metidos dentro del nombre del producto, y acá
          se separan a mano: no se deducen del texto.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">
          Sin clasificar{" "}
          <span className="font-normal text-slate-400">
            ({sinClasificar.length})
          </span>
        </h2>
        {sinClasificar.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
            Todos los productos que aparecieron en órdenes están clasificados.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-amber-200 bg-white">
            {sinClasificar.map((p) => (
              <div
                key={`${p.odoo_product_id ?? "raw"}-${p.producto_raw ?? ""}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">
                    {p.producto_raw ?? "(sin producto)"}
                  </div>
                  <div className="text-xs text-slate-400">
                    {p.ordenes} {p.ordenes === 1 ? "orden" : "órdenes"}
                    {p.odoo_product_id === null &&
                      " · órdenes cargadas sin remito: no hay producto de Odoo para mapear"}
                  </div>
                </div>
                {p.odoo_product_id !== null && (
                  <button
                    onClick={() => abrir(p)}
                    className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                  >
                    Clasificar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {clasificando && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Clasificar</h3>
              <p className="text-sm text-slate-500">{clasificando.producto_raw}</p>
            </div>
            <button
              onClick={() => setClasificando(null)}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Cancelar
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Material</span>
              <select
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Elegir…</option>
                {MATERIALES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Granulometría</span>
              <select
                value={granulometria}
                onChange={(e) => setGranulometria(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">No tiene</option>
                {GRANULOMETRIAS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Envase</span>
              <select
                value={envase}
                onChange={(e) => setEnvase(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Elegir…</option>
                {ENVASES.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">
                Producto de Producción
              </span>
              <select
                value={puente}
                onChange={(e) => setPuente(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Ninguno</option>
                {productosDeProduccion.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-400">
                Opcional: el granel no está en el catálogo de fábrica.
              </span>
            </label>
          </div>

          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar la clasificación"}
          </button>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">
          Clasificados <span className="font-normal text-slate-400">({mapeo.length})</span>
        </h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Producto de Odoo</th>
                  <th className="px-3 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-left">Granulometría</th>
                  <th className="px-3 py-2 text-left">Envase</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mapeo.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                      Todavía no se clasificó ningún producto.
                    </td>
                  </tr>
                ) : (
                  mapeo.map((p) => (
                    <tr key={p.id} className={`hover:bg-slate-50 ${p.activo ? "" : "opacity-50"}`}>
                      <td className="px-3 py-2 text-slate-500">{p.odoo_default_code ?? "—"}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{p.odoo_nombre}</td>
                      <td className="px-3 py-2 text-slate-700">{p.material}</td>
                      <td className="px-3 py-2 text-slate-600">{p.granulometria ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{p.envase}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => alternarActivo(p)}
                          className="text-sm text-slate-500 underline hover:text-slate-700"
                        >
                          {p.activo ? "Desactivar" : "Activar"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
