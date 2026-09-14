"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Fletero } from "@/lib/cantera/types";

const VACIO = { nombre: "", patente: "" };
const INPUT_CLS = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";

export default function FleterosClient({ fleteros }: { fleteros: Fletero[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [alta, setAlta] = useState(VACIO);

  async function crear() {
    if (!alta.nombre.trim()) {
      setError("Falta el nombre del fletero.");
      return;
    }
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/fleteros", {
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

  async function alternarActivo(f: Fletero) {
    const res = await fetch("/api/cantera/fleteros", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: f.id, activo: !f.activo }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <h1 className="mt-1 text-xl font-semibold">Fleteros</h1>
      <p className="mt-1 text-sm text-slate-500">Quiénes hacen el acarreo cantera → plantas/reservas.</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 space-y-2">
        {fleteros.map((f) => (
          <div key={f.id} className={`flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm ${f.activo ? "" : "opacity-50"}`}>
            <div>
              <span className="font-medium">{f.nombre}</span>
              {f.patente && <span className="ml-2 font-mono text-xs text-slate-500">{f.patente}</span>}
            </div>
            <button onClick={() => alternarActivo(f)} className="text-xs text-slate-500 underline">
              {f.activo ? "Desactivar" : "Reactivar"}
            </button>
          </div>
        ))}
        {fleteros.length === 0 && <p className="text-sm text-slate-400">Sin fleteros cargados.</p>}
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold">Nuevo fletero</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-600">
            Nombre
            <input className={INPUT_CLS} value={alta.nombre} onChange={(e) => setAlta({ ...alta, nombre: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">
            Patente
            <input className={INPUT_CLS} value={alta.patente} onChange={(e) => setAlta({ ...alta, patente: e.target.value })} />
          </label>
        </div>
        <button disabled={guardando} onClick={crear} className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50">
          {guardando ? "Guardando…" : "Agregar fletero"}
        </button>
      </div>
    </div>
  );
}
