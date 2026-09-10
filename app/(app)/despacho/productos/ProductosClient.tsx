"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ENVASES,
  GRANULOMETRIAS,
  MATERIALES,
  separarCodigoYNombre,
} from "@/lib/core/productos";
import type { FilaDeCatalogo, FueraDelCatalogo } from "./page";

/**
 * Clasificar el catálogo de productos.
 *
 * Los tres campos se eligen de una lista y no se escriben: un material tipeado a
 * mano entra con un typo y aparece como un material nuevo en los filtros del
 * histórico. La base los guarda como texto —un enum de Postgres cuesta una
 * migración sola por valor nuevo, y estas listas van a crecer— así que la
 * validación está en la ruta y la lista, acá.
 *
 * Un producto **no se borra**: las órdenes viejas lo referencian por
 * `odoo_product_id` y perder su clasificación las dejaría sin material. El botón
 * dice "Desactivar" y lo saca del alta sin tocar su historia.
 */

export default function ProductosClient({
  sinClasificar,
  clasificados,
  fueraDelCatalogo,
}: {
  sinClasificar: FilaDeCatalogo[];
  clasificados: FilaDeCatalogo[];
  fueraDelCatalogo: FueraDelCatalogo[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  /** El id del producto del catálogo que se está clasificando. */
  const [editando, setEditando] = useState<FilaDeCatalogo | null>(null);
  /** El de Odoo que hay que sumar al catálogo antes de clasificarlo. */
  const [sumando, setSumando] = useState<FueraDelCatalogo | null>(null);

  const [material, setMaterial] = useState("");
  const [granulometria, setGranulometria] = useState("");
  const [envase, setEnvase] = useState("");

  function abrirEdicion(f: FilaDeCatalogo) {
    setEditando(f);
    setSumando(null);
    setMaterial(f.producto.material ?? "");
    setGranulometria(f.producto.granulometria ?? "");
    setEnvase(f.producto.envase ?? "");
    setError("");
  }

  function abrirAlta(p: FueraDelCatalogo) {
    setSumando(p);
    setEditando(null);
    setMaterial("");
    setGranulometria("");
    setEnvase("");
    setError("");
  }

  function cerrar() {
    setEditando(null);
    setSumando(null);
    setError("");
  }

  async function llamar(metodo: "POST" | "PATCH", cuerpo: Record<string, unknown>) {
    setGuardando(true);
    setError("");
    const res = await fetch("/api/despacho/productos", {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return false;
    }
    return true;
  }

  async function guardar() {
    if (!material || !envase) {
      setError("Faltan el material y el envase. La clasificación va entera o vacía.");
      return;
    }
    const clasificacion = { material, granulometria: granulometria || null, envase };

    const ok = editando
      ? await llamar("PATCH", { id: editando.producto.id, ...clasificacion })
      : sumando && sumando.odoo_product_id !== null
        ? await llamar("POST", {
            odoo_product_id: sumando.odoo_product_id,
            // El producto llega como "[FAG] FILLER A GRANEL " desde Odoo.
            ...(() => {
              const { codigo, nombre } = separarCodigoYNombre(sumando.producto_raw ?? "");
              return { odoo_default_code: codigo, nombre: nombre ?? sumando.producto_raw ?? "" };
            })(),
            ...clasificacion,
          })
        : false;

    if (ok) {
      cerrar();
      router.refresh();
    }
  }

  async function alternarActivo(f: FilaDeCatalogo) {
    if (await llamar("PATCH", { id: f.producto.id, activo: !f.producto.activo })) router.refresh();
  }

  const abierto = editando ?? sumando;

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Productos</h1>
        <p className="text-sm text-slate-500">
          Qué material, granulometría y envase es cada producto. Los tres campos
          del talonario están metidos dentro del nombre del producto de Odoo, y
          acá se separan a mano: no se deducen del texto. Un producto puede no
          tener terna —Minerales Ecológicos, Binder— y ésos se muestran con su
          nombre.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {fueraDelCatalogo.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">
            Apareció en órdenes y no está en el catálogo{" "}
            <span className="font-normal text-slate-400">({fueraDelCatalogo.length})</span>
          </h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-amber-200 bg-white">
            {fueraDelCatalogo.map((p) => (
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
                      " · cargadas sin remito: no hay producto de Odoo que sumar"}
                  </div>
                </div>
                {p.odoo_product_id !== null && (
                  <button
                    onClick={() => abrirAlta(p)}
                    className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                  >
                    Sumar y clasificar
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {abierto && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">
                {editando ? "Cambiar la clasificación" : "Sumar al catálogo"}
              </h3>
              <p className="text-sm text-slate-500">
                {editando ? editando.producto.nombre : sumando?.producto_raw}
              </p>
            </div>
            <button onClick={cerrar} className="text-sm text-slate-500 hover:text-slate-700">
              Cancelar
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
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

      <Tabla
        titulo="Sin clasificar"
        filas={sinClasificar}
        vacio="Todo el catálogo está clasificado."
        borde="border-amber-200"
        onEditar={abrirEdicion}
        onAlternar={alternarActivo}
      />

      <Tabla
        titulo="Clasificados"
        filas={clasificados}
        vacio="Todavía no se clasificó ningún producto."
        borde="border-slate-200"
        onEditar={abrirEdicion}
        onAlternar={alternarActivo}
      />
    </div>
  );
}

function Tabla({
  titulo,
  filas,
  vacio,
  borde,
  onEditar,
  onAlternar,
}: {
  titulo: string;
  filas: FilaDeCatalogo[];
  vacio: string;
  borde: string;
  onEditar: (f: FilaDeCatalogo) => void;
  onAlternar: (f: FilaDeCatalogo) => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-slate-900">
        {titulo} <span className="font-normal text-slate-400">({filas.length})</span>
      </h2>
      <div className={`overflow-hidden rounded-xl border bg-white ${borde}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Órdenes</th>
                <th className="px-3 py-2 text-left">Material</th>
                <th className="px-3 py-2 text-left">Granulometría</th>
                <th className="px-3 py-2 text-left">Envase</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                    {vacio}
                  </td>
                </tr>
              ) : (
                filas.map(({ producto, ordenes }) => (
                  <tr
                    key={producto.id}
                    className={`hover:bg-slate-50 ${producto.activo ? "" : "opacity-50"}`}
                  >
                    <td className="px-3 py-2 text-slate-500">
                      {producto.odoo_default_code ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">{producto.nombre}</td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {ordenes === 0 ? "—" : ordenes}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{producto.material ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{producto.granulometria ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{producto.envase ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onEditar({ producto, ordenes })}
                        className="text-sm text-slate-500 underline hover:text-slate-700"
                      >
                        Clasificar
                      </button>
                      <button
                        onClick={() => onAlternar({ producto, ordenes })}
                        className="ml-3 text-sm text-slate-500 underline hover:text-slate-700"
                      >
                        {producto.activo ? "Desactivar" : "Activar"}
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
  );
}
