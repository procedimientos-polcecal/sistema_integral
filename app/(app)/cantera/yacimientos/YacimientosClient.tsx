"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MATERIALES } from "@/lib/cantera/vocabulario";
import type { Yacimiento } from "@/lib/cantera/types";

/**
 * Alta y edición de canteras.
 *
 * El `codigo` corto es el que se mete adentro del código de voladura
 * (`V01D625` → "D6"), así que no se edita después de crear: cambiarlo dejaría
 * las voladuras viejas apuntando a un código que ya no existe. La densidad va
 * con el material —Dolomita 2,65, Chocolata 2,7— y es lo que usa el cálculo de
 * toneladas.
 *
 * No se borra: "Desactivar" lo saca del selector sin tocar su historia.
 */

const VACIO = { codigo: "", nombre: "", material: "", densidad_t_m3: "", burden_m: "", espaciamiento_m: "" };

export default function YacimientosClient({ yacimientos }: { yacimientos: Yacimiento[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [alta, setAlta] = useState(VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [edicion, setEdicion] = useState(VACIO);

  async function crear() {
    if (!alta.codigo.trim() || !alta.nombre.trim() || !alta.material || !alta.densidad_t_m3) {
      setError("Faltan código, nombre, material o densidad.");
      return;
    }
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/yacimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setAlta(VACIO);
    router.refresh();
  }

  async function guardarEdicion(id: string) {
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/yacimientos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...edicion }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setEditando(null);
    router.refresh();
  }

  async function alternarActivo(y: Yacimiento) {
    const res = await fetch("/api/cantera/yacimientos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: y.id, activo: !y.activo }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold">Canteras</h1>
      <p className="mt-1 text-sm text-slate-500">
        El código corto es el que va dentro del código de voladura. La densidad la usa el cálculo de toneladas.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Material</th>
              <th className="px-3 py-2">Densidad</th>
              <th className="px-3 py-2">Burden</th>
              <th className="px-3 py-2">Espaciam.</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {yacimientos.map((y) =>
              editando === y.id ? (
                <tr key={y.id} className="bg-amber-50">
                  <td className="px-3 py-2 font-mono">{y.codigo}</td>
                  <td className="px-2 py-2">
                    <input className="w-full rounded border px-2 py-1" value={edicion.nombre}
                      onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <select className="rounded border px-2 py-1" value={edicion.material}
                      onChange={(e) => setEdicion({ ...edicion, material: e.target.value })}>
                      {MATERIALES.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input className="w-20 rounded border px-2 py-1" value={edicion.densidad_t_m3}
                      onChange={(e) => setEdicion({ ...edicion, densidad_t_m3: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <input className="w-20 rounded border px-2 py-1" value={edicion.burden_m}
                      onChange={(e) => setEdicion({ ...edicion, burden_m: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <input className="w-20 rounded border px-2 py-1" value={edicion.espaciamiento_m}
                      onChange={(e) => setEdicion({ ...edicion, espaciamiento_m: e.target.value })} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button disabled={guardando} onClick={() => guardarEdicion(y.id)}
                      className="rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-50">Guardar</button>
                    <button onClick={() => setEditando(null)} className="ml-1 rounded border px-2 py-1 text-xs">Cancelar</button>
                  </td>
                </tr>
              ) : (
                <tr key={y.id} className={y.activo ? "" : "text-slate-400"}>
                  <td className="px-3 py-2 font-mono">{y.codigo}</td>
                  <td className="px-3 py-2">{y.nombre}</td>
                  <td className="px-3 py-2">{y.material}</td>
                  <td className="px-3 py-2">{y.densidad_t_m3}</td>
                  <td className="px-3 py-2">{y.burden_m ?? "—"}</td>
                  <td className="px-3 py-2">{y.espaciamiento_m ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        setEditando(y.id);
                        setEdicion({
                          codigo: y.codigo,
                          nombre: y.nombre,
                          material: y.material,
                          densidad_t_m3: String(y.densidad_t_m3 ?? ""),
                          burden_m: String(y.burden_m ?? ""),
                          espaciamiento_m: String(y.espaciamiento_m ?? ""),
                        });
                      }}
                      className="rounded border px-2 py-1 text-xs"
                    >
                      Editar
                    </button>
                    <button onClick={() => alternarActivo(y)} className="ml-1 rounded border px-2 py-1 text-xs">
                      {y.activo ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              )
            )}
            {yacimientos.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Todavía no hay canteras.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold">Nueva cantera</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-600">
            Código corto
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm font-mono" placeholder="D6"
              value={alta.codigo} onChange={(e) => setAlta({ ...alta, codigo: e.target.value.toUpperCase() })} />
          </label>
          <label className="text-xs text-slate-600">
            Nombre
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder="Cantera D6"
              value={alta.nombre} onChange={(e) => setAlta({ ...alta, nombre: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">
            Material
            <select className="mt-1 w-full rounded border px-2 py-1 text-sm"
              value={alta.material} onChange={(e) => setAlta({ ...alta, material: e.target.value })}>
              <option value="">—</option>
              {MATERIALES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Densidad (t/m³)
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder="2.65"
              value={alta.densidad_t_m3} onChange={(e) => setAlta({ ...alta, densidad_t_m3: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">
            Burden (m)
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder="2.8"
              value={alta.burden_m} onChange={(e) => setAlta({ ...alta, burden_m: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">
            Espaciamiento (m)
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder="2.5"
              value={alta.espaciamiento_m} onChange={(e) => setAlta({ ...alta, espaciamiento_m: e.target.value })} />
          </label>
        </div>
        <button disabled={guardando} onClick={crear}
          className="mt-3 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">
          Agregar
        </button>
      </div>
    </div>
  );
}
