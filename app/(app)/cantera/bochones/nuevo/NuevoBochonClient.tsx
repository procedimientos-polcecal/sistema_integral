"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Yacimiento } from "@/lib/cantera/types";

export default function NuevoBochonClient({
  yacimientos,
  yacimientoPreseleccionado,
}: {
  yacimientos: Yacimiento[];
  yacimientoPreseleccionado: string;
}) {
  const router = useRouter();
  const [yacimientoId, setYacimientoId] = useState(
    yacimientos.some((y) => y.id === yacimientoPreseleccionado)
      ? yacimientoPreseleccionado
      : (yacimientos[0]?.id ?? "")
  );
  const [fecha, setFecha] = useState("");
  const [voladura, setVoladura] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function crear() {
    if (!yacimientoId) return;
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/bochones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yacimiento_id: yacimientoId,
        fecha_voladura: fecha || null,
        voladura_codigo: voladura || null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setGuardando(false);
      setError(json.error ?? "No se pudo crear.");
      return;
    }
    router.push(`/cantera/bochones/${json.data.codigo}`);
  }

  if (yacimientos.length === 0) {
    return (
      <p className="mx-auto max-w-lg text-center text-sm text-slate-500">
        Primero hay que cargar canteras en{" "}
        <Link href="/cantera/yacimientos" className="underline">Canteras</Link>.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">Nuevo bochón</h1>
      <p className="mt-1 text-sm text-slate-500">
        El código se arma con la cantera y el año. El resto se completa después.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 space-y-3">
        <label className="block text-sm">
          Cantera
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={yacimientoId}
            onChange={(e) => setYacimientoId(e.target.value)}
          >
            {yacimientos.map((y) => (
              <option key={y.id} value={y.id}>{y.nombre} · {y.material}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Fecha de voladura <span className="text-slate-400">(opcional)</span>
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Voladura asociada <span className="text-slate-400">(opcional)</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
            placeholder="V03D626"
            value={voladura}
            onChange={(e) => setVoladura(e.target.value.toUpperCase())}
          />
        </label>
        <button
          disabled={guardando || !yacimientoId}
          onClick={crear}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {guardando ? "Creando…" : "Crear y completar"}
        </button>
      </div>
    </div>
  );
}
