"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RenglonDePapel, Familia } from "@/lib/produccion/types";
import type { Producto } from "@/lib/core/types";
import { clasificacionDelProducto, textoDeClasificacion } from "@/lib/core/productos";

const FAMILIAS: { valor: Familia; label: string }[] = [
  { valor: "filler", label: "Filler" },
  { valor: "0_2", label: "0-2" },
  { valor: "cal", label: "Cal" },
  { valor: "otros", label: "Otros" },
];

const familiaLabel = (f: Familia) => FAMILIAS.find((x) => x.valor === f)?.label ?? f;

/** Cómo se nombra un producto del catálogo: su terna si la tiene, y si no, su nombre. */
function comoSeLee(p: Producto): string {
  return textoDeClasificacion(clasificacionDelProducto(p)) || p.nombre;
}

/**
 * Los renglones del parte en papel, y qué productos cuenta cada uno.
 *
 * El renglón es cómo se ve el papel: su nombre, su familia, su columna en el
 * Excel. El producto es la cosa física, del catálogo del núcleo. Enlazarlos es
 * lo único que **no se puede deducir**: la correspondencia vive en la cabeza de
 * quien carga hoy el Excel, y hasta que se cargue acá los renglones se pueden
 * usar igual — lo único que no corre es la comprobación kilos↔bultos, porque el
 * kg por unidad es del producto.
 *
 * Un renglón **no se borra**: los partes viejos lo referencian por FK
 * (`produccion_deposito.renglon_papel_id`,
 * `produccion_despachos.renglon_papel_id`), así que el botón dice "Desactivar" y
 * no "Eliminar" — y desactivado se puede volver a activar.
 */
export default function RenglonesClient({
  renglonesIniciales,
  catalogo,
  enlacesIniciales,
}: {
  renglonesIniciales: RenglonDePapel[];
  catalogo: Producto[];
  enlacesIniciales: Record<string, string[]>;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<RenglonDePapel | null>(null);
  const [creando, setCreando] = useState(false);
  const [enlazando, setEnlazando] = useState<RenglonDePapel | null>(null);
  const [error, setError] = useState("");
  const [cambiandoId, setCambiandoId] = useState<string | null>(null);

  const porId = new Map(catalogo.map((p) => [p.id, p]));

  async function alternarActivo(r: RenglonDePapel) {
    setError("");
    setCambiandoId(r.id);
    const res = await fetch("/api/produccion/productos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, activo: !r.activo }),
    });
    setCambiandoId(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Renglones del parte</h1>
          <p className="text-sm text-slate-500">
            Los renglones del papel y las columnas de los resúmenes:{" "}
            {renglonesIniciales.length} en total. Los productos son otra cosa
            —viven en el catálogo que Producción comparte con Despacho— y acá se
            dice qué productos cuenta cada renglón.
          </p>
        </div>
        <button
          onClick={() => setCreando(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          + Nuevo renglón
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
                <th className="px-3 py-2 text-left">Renglón</th>
                <th className="px-3 py-2 text-left">Familia</th>
                <th className="px-3 py-2 text-left">Productos que cuenta</th>
                <th className="px-3 py-2 text-left">Columna en la planilla</th>
                <th className="px-3 py-2 text-right">Orden</th>
                <th className="px-3 py-2 text-left">Activo</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {renglonesIniciales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                    Todavía no hay ningún renglón. La lista la define calidad, renglón
                    por renglón del papel.
                  </td>
                </tr>
              ) : (
                renglonesIniciales.map((r) => {
                  const enlazados = (enlacesIniciales[r.id] ?? [])
                    .map((id) => porId.get(id))
                    .filter((p): p is Producto => p !== undefined);
                  return (
                    <tr key={r.id} className={`hover:bg-slate-50 ${r.activo ? "" : "opacity-50"}`}>
                      <td className="px-3 py-2 font-medium text-slate-900">{r.nombre}</td>
                      <td className="px-3 py-2 text-slate-600">{familiaLabel(r.familia)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {enlazados.length === 0 ? (
                          <span
                            className="text-amber-700"
                            title="Sin esto no corre la comprobación de kilos contra bultos de este renglón"
                          >
                            sin definir
                          </span>
                        ) : (
                          enlazados.map((p) => comoSeLee(p)).join(" · ")
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {r.nombre_planilla ?? (
                          <span className="text-slate-400" title="No se exporta a la planilla">
                            no se exporta
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{r.orden}</td>
                      <td className="px-3 py-2 text-slate-600">{r.activo ? "Sí" : "No"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button
                          onClick={() => setEnlazando(r)}
                          className="text-xs text-slate-500 hover:text-slate-900"
                        >
                          Productos
                        </button>
                        <button
                          onClick={() => setEditando(r)}
                          className="ml-3 text-xs text-slate-500 hover:text-slate-900"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => alternarActivo(r)}
                          disabled={cambiandoId === r.id}
                          className={`ml-3 text-xs disabled:opacity-50 ${
                            r.activo ? "text-red-600 hover:text-red-800" : "text-emerald-600 hover:text-emerald-800"
                          }`}
                        >
                          {cambiandoId === r.id ? "…" : r.activo ? "Desactivar" : "Activar"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Un renglón no se borra: los partes viejos lo referencian. "Desactivar" lo
        saca de la carga y de las pantallas activas sin tocar su historia, y se
        puede volver a activar en cualquier momento.
      </p>

      {(editando || creando) && (
        <ModalRenglon
          renglon={editando}
          onClose={() => { setEditando(null); setCreando(false); }}
          onSaved={() => { setEditando(null); setCreando(false); router.refresh(); }}
        />
      )}

      {enlazando && (
        <ModalEnlaces
          renglon={enlazando}
          catalogo={catalogo}
          elegidos={enlacesIniciales[enlazando.id] ?? []}
          onClose={() => setEnlazando(null)}
          onSaved={() => { setEnlazando(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function ModalRenglon({
  renglon, onClose, onSaved,
}: {
  renglon: RenglonDePapel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(renglon?.nombre ?? "");
  const [familia, setFamilia] = useState<Familia>(renglon?.familia ?? "otros");
  const [nombrePlanilla, setNombrePlanilla] = useState(renglon?.nombre_planilla ?? "");
  const [orden, setOrden] = useState(renglon?.orden != null ? String(renglon.orden) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");

    const cuerpo: Record<string, unknown> = {
      nombre: nombre.trim(),
      familia,
      // Vacío es "no se exporta a la planilla", una decisión y no un olvido.
      nombre_planilla: nombrePlanilla.trim() || null,
    };
    // El orden se manda sólo si se tipeó: en el alta lo calcula la ruta ("el
    // siguiente lugar"), y mandar 0 dejaría el renglón nuevo primero.
    if (orden.trim() !== "") cuerpo.orden = Number(orden);
    if (renglon) cuerpo.id = renglon.id;

    const res = await fetch("/api/produccion/productos", {
      method: renglon ? "PATCH" : "POST",
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
    <Modal titulo={renglon ? "Editar el renglón" : "Nuevo renglón"} onClose={onClose}>
      <form onSubmit={enviar} className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Nombre, como está en el papel</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Familia</span>
          <select
            value={familia}
            onChange={(e) => setFamilia(e.target.value as Familia)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {FAMILIAS.map((f) => (
              <option key={f.valor} value={f.valor}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Columna en la planilla</span>
          <input
            value={nombrePlanilla}
            onChange={(e) => setNombrePlanilla(e.target.value)}
            placeholder="Vacío = no se exporta"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Orden</span>
          <input
            value={orden}
            onChange={(e) => setOrden(e.target.value)}
            inputMode="numeric"
            placeholder={renglon ? "" : "Vacío = al final"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Qué productos cuenta este renglón.
 *
 * Se manda el conjunto completo y no de a uno: es lo que la pantalla sabe, y
 * calcular el diff acá dejaría enlaces viejos sumando producción en el renglón
 * equivocado si el cálculo se equivoca.
 */
function ModalEnlaces({
  renglon, catalogo, elegidos, onClose, onSaved,
}: {
  renglon: RenglonDePapel;
  catalogo: Producto[];
  elegidos: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set(elegidos));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  function alternar(id: string) {
    const nueva = new Set(seleccion);
    if (nueva.has(id)) nueva.delete(id);
    else nueva.add(id);
    setSeleccion(nueva);
  }

  async function guardar() {
    setGuardando(true);
    setError("");
    const res = await fetch("/api/produccion/productos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ renglon_papel_id: renglon.id, producto_ids: [...seleccion] }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo guardar.");
      return;
    }
    onSaved();
  }

  return (
    <Modal titulo={`Productos de "${renglon.nombre}"`} onClose={onClose}>
      <p className="text-sm text-slate-500">
        Lo que este renglón del papel cuenta. Pueden ser varios: si el papel
        junta las variantes de un producto en un solo renglón, se marcan todas y
        la suma sale bien.
      </p>

      <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {catalogo.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">
            El catálogo de productos está vacío.
          </p>
        ) : (
          catalogo.map((p) => (
            <label
              key={p.id}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${
                p.activo ? "" : "opacity-50"
              }`}
            >
              <input
                type="checkbox"
                checked={seleccion.has(p.id)}
                onChange={() => alternar(p.id)}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-slate-900">{p.nombre}</span>
                {p.odoo_default_code && (
                  <span className="ml-2 text-xs text-slate-400">[{p.odoo_default_code}]</span>
                )}
                <span className="ml-2 text-xs text-slate-500">
                  {textoDeClasificacion(clasificacionDelProducto(p)) || "sin clasificar"}
                  {p.kg_por_unidad != null && ` · ${p.kg_por_unidad} kg`}
                </span>
              </span>
            </label>
          ))
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
          Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
        >
          {guardando ? "Guardando…" : `Guardar (${seleccion.size})`}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  titulo, onClose, children,
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold text-slate-900">{titulo}</h2>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
