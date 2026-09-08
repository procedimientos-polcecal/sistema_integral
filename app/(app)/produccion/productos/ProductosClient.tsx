"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Producto, Familia, Envase } from "@/lib/produccion/types";

const FAMILIAS: { valor: Familia; label: string }[] = [
  { valor: "filler", label: "Filler" },
  { valor: "0_2", label: "0-2" },
  { valor: "cal", label: "Cal" },
  { valor: "otros", label: "Otros" },
];

const ENVASES: { valor: Envase; label: string }[] = [
  { valor: "bolsa", label: "Bolsa" },
  { valor: "bolson", label: "Bolsón" },
];

const familiaLabel = (f: Familia) => FAMILIAS.find((x) => x.valor === f)?.label ?? f;
const envaseLabel = (e: Envase) => ENVASES.find((x) => x.valor === e)?.label ?? e;

/**
 * El catálogo de productos de Producción: de acá salen los renglones del
 * parte y las columnas de los resúmenes.
 *
 * Un producto **no se borra**: los partes viejos lo referencian por FK
 * (`produccion_deposito.producto_id`, `produccion_despachos.producto_id`), así
 * que el botón dice "Desactivar" y no "Eliminar" — y desactivado se puede
 * volver a activar. Sale de la carga y de las pantallas activas sin tocar su
 * historia.
 */
export default function ProductosClient({
  productosIniciales,
}: {
  productosIniciales: Producto[];
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<Producto | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");
  const [cambiandoId, setCambiandoId] = useState<string | null>(null);

  async function alternarActivo(p: Producto) {
    setError("");
    setCambiandoId(p.id);
    const res = await fetch("/api/produccion/productos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, activo: !p.activo }),
    });
    setCambiandoId(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Productos</h1>
          <p className="text-sm text-slate-500">
            El catálogo del que salen los renglones del parte y las columnas de
            los resúmenes. {productosIniciales.length} en total.
          </p>
        </div>
        <button
          onClick={() => setCreando(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          + Nuevo producto
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Familia</th>
                <th className="px-3 py-2 text-left">Envase</th>
                <th className="px-3 py-2 text-right">Kg por unidad</th>
                <th className="px-3 py-2 text-left">Columna en la planilla</th>
                <th className="px-3 py-2 text-right">Orden</th>
                <th className="px-3 py-2 text-left">Activo</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productosIniciales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                    Todavía no hay ningún producto.
                  </td>
                </tr>
              ) : (
                productosIniciales.map((p) => (
                  <tr key={p.id} className={`hover:bg-slate-50 ${p.activo ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2 font-medium text-slate-900">{p.nombre}</td>
                    <td className="px-3 py-2 text-slate-600">{familiaLabel(p.familia)}</td>
                    <td className="px-3 py-2 text-slate-600">{envaseLabel(p.envase)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {p.kg_por_unidad ?? (
                        <span
                          className="text-slate-400"
                          title="Sin confirmar: no se puede comprobar kilos contra bultos para este producto"
                        >
                          sin confirmar
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {p.nombre_planilla ?? (
                        <span className="text-slate-400" title="No se exporta a la planilla">
                          no se exporta
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{p.orden}</td>
                    <td className="px-3 py-2 text-slate-600">{p.activo ? "Sí" : "No"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button onClick={() => setEditando(p)} className="text-xs text-slate-500 hover:text-slate-900">
                        Editar
                      </button>
                      <button
                        onClick={() => alternarActivo(p)}
                        disabled={cambiandoId === p.id}
                        className={`ml-3 text-xs disabled:opacity-50 ${
                          p.activo ? "text-red-600 hover:text-red-800" : "text-emerald-600 hover:text-emerald-800"
                        }`}
                      >
                        {cambiandoId === p.id ? "…" : p.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Un producto no se borra: los partes viejos lo referencian. "Desactivar"
        lo saca de la carga y de las pantallas activas sin tocar su historia, y
        se puede volver a activar en cualquier momento.
      </p>

      {(editando || creando) && (
        <ModalProducto
          producto={editando}
          onClose={() => { setEditando(null); setCreando(false); }}
          onSaved={() => { setEditando(null); setCreando(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

function ModalProducto({
  producto, onClose, onSaved,
}: {
  producto: Producto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [familia, setFamilia] = useState<Familia>(producto?.familia ?? "otros");
  const [envase, setEnvase] = useState<Envase>(producto?.envase ?? "bolsa");
  const [kgPorUnidad, setKgPorUnidad] = useState(
    producto?.kg_por_unidad != null ? String(producto.kg_por_unidad) : ""
  );
  const [nombrePlanilla, setNombrePlanilla] = useState(producto?.nombre_planilla ?? "");
  const [orden, setOrden] = useState(producto?.orden != null ? String(producto.orden) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");

    const cuerpo: Record<string, unknown> = {
      nombre: nombre.trim(),
      familia,
      envase,
      // Vacío es "sin confirmar" —el bolsón puede no tener los kilos
      // acordados todavía—, no cero: un cero apagaría la comprobación de
      // kilos contra bultos en vez de dejarla afuera.
      kg_por_unidad: kgPorUnidad.trim() === "" ? null : Number(kgPorUnidad),
      // Vacío es "no se exporta a la planilla", una decisión y no un olvido.
      nombre_planilla: nombrePlanilla.trim() || null,
    };
    if (producto) cuerpo.id = producto.id;
    // De alta sin tocar este campo, el servidor calcula "al final de su
    // familia" — no hace falta adivinar un número acá.
    if (orden.trim() !== "") cuerpo.orden = Number(orden);

    const res = await fetch("/api/produccion/productos", {
      method: producto ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });

    setGuardando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return;
    }
    onSaved();
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="mt-16 w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            {producto ? "Editar producto" : "Nuevo producto"}
          </h2>
        </div>

        <form onSubmit={enviar} className="space-y-4 px-6 py-5">
          <Campo label="Nombre" requerido>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus
            />
          </Campo>

          <div className="grid grid-cols-2 gap-4">
            <Campo label="Familia">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={familia} onChange={(e) => setFamilia(e.target.value as Familia)}
              >
                {FAMILIAS.map((f) => <option key={f.valor} value={f.valor}>{f.label}</option>)}
              </select>
            </Campo>
            <Campo label="Envase">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={envase} onChange={(e) => setEnvase(e.target.value as Envase)}
              >
                {ENVASES.map((en) => <option key={en.valor} value={en.valor}>{en.label}</option>)}
              </select>
            </Campo>
          </div>

          <Campo label="Kg por unidad">
            <input
              type="number" min="0" step="any"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={kgPorUnidad} onChange={(e) => setKgPorUnidad(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              La bolsa son 25 kg. Dejalo vacío si es un bolsón sin los kilos
              todavía confirmados: vacío significa que no se puede comprobar
              kilos contra bultos para este producto, no cero.
            </p>
          </Campo>

          <Campo label="Columna en la planilla">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={nombrePlanilla} onChange={(e) => setNombrePlanilla(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Vacío significa que este producto no se exporta a la planilla: no
              va a aparecer en los resúmenes que mira gerencia.
            </p>
          </Campo>

          <Campo label="Orden">
            <input
              type="number" step="1"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={orden} onChange={(e) => setOrden(e.target.value)}
              placeholder={producto ? undefined : "vacío = al final de su familia"}
            />
            <p className="mt-1 text-xs text-slate-500">
              El lugar dentro de su familia en la carga del parte y en los
              resúmenes.{!producto && " Vacío lo deja al final."}
            </p>
          </Campo>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button" onClick={onClose} disabled={guardando}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={guardando || !nombre.trim()}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Campo({ label, requerido, children }: { label: string; requerido?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}{requerido && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
