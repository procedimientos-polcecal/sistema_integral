"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ETIQUETA_TIPO_CONSUMO, TIPOS_DE_CONSUMO } from "@/lib/cantera/vocabulario";
import type { Insumo } from "@/lib/cantera/types";

/**
 * Alta y edición del catálogo de insumos.
 *
 * El nombre canónico acá es lo que colapsa las tres formas en que la planilla
 * escribe el mismo insumo (`"detonadores x 4,8"` / `"x 4,80"` / `"x 4,80 mts"`).
 * El precio USD es el vigente; el renglón de consumo de una voladura lo puede
 * pisar si esa compra salió a otro precio.
 */

const VACIO = { nombre: "", tipo: "detonador", precio_usd: "" };

export default function InsumosClient({ insumos }: { insumos: Insumo[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [alta, setAlta] = useState(VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [precioEdit, setPrecioEdit] = useState("");

  async function crear() {
    if (!alta.nombre.trim()) {
      setError("Falta el nombre del insumo.");
      return;
    }
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/insumos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setAlta({ ...VACIO, tipo: alta.tipo });
    router.refresh();
  }

  async function patch(id: string, cambios: Record<string, unknown>) {
    const res = await fetch("/api/cantera/insumos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...cambios }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setEditando(null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <h1 className="mt-1 text-xl font-semibold">Insumos de voladura</h1>
      <p className="mt-1 text-sm text-slate-500">
        El precio USD es el vigente; cada renglón de consumo lo puede pisar.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Insumo</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Precio USD</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {insumos.map((i) => (
              <tr key={i.id} className={i.activo ? "" : "text-slate-400"}>
                <td className="px-3 py-2">{i.nombre}</td>
                <td className="px-3 py-2">{ETIQUETA_TIPO_CONSUMO[i.tipo as keyof typeof ETIQUETA_TIPO_CONSUMO] ?? i.tipo}</td>
                <td className="px-3 py-2">
                  {editando === i.id ? (
                    <input
                      autoFocus
                      className="w-24 rounded border px-2 py-1"
                      value={precioEdit}
                      onChange={(e) => setPrecioEdit(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && patch(i.id, { precio_usd: precioEdit })}
                    />
                  ) : (
                    i.precio_usd ?? "—"
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {editando === i.id ? (
                    <>
                      <button onClick={() => patch(i.id, { precio_usd: precioEdit })}
                        className="rounded bg-slate-800 px-2 py-1 text-xs text-white">Guardar</button>
                      <button onClick={() => setEditando(null)} className="ml-1 rounded border px-2 py-1 text-xs">Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditando(i.id); setPrecioEdit(String(i.precio_usd ?? "")); }}
                        className="rounded border px-2 py-1 text-xs">Precio</button>
                      <button onClick={() => patch(i.id, { activo: !i.activo })}
                        className="ml-1 rounded border px-2 py-1 text-xs">{i.activo ? "Desactivar" : "Activar"}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {insumos.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Todavía no hay insumos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold">Nuevo insumo</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-600 sm:col-span-1">
            Nombre
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder="Emulex x 60 mm"
              value={alta.nombre} onChange={(e) => setAlta({ ...alta, nombre: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">
            Tipo
            <select className="mt-1 w-full rounded border px-2 py-1 text-sm"
              value={alta.tipo} onChange={(e) => setAlta({ ...alta, tipo: e.target.value })}>
              {TIPOS_DE_CONSUMO.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO_CONSUMO[t]}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Precio USD
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder="4.24"
              value={alta.precio_usd} onChange={(e) => setAlta({ ...alta, precio_usd: e.target.value })} />
          </label>
        </div>
        <button disabled={guardando} onClick={crear}
          className="mt-3 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">Agregar</button>
      </div>
    </div>
  );
}
