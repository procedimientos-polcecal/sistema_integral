"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { armarCodigo, anioParaCodigo, proximoCorrelativo } from "@/lib/cantera/codigos";
import type { Yacimiento } from "@/lib/cantera/types";

export default function NuevaVoladuraClient({
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
  const [volFecha, setVolFecha] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const yac = yacimientos.find((y) => y.id === yacimientoId);
  const anio = anioParaCodigo(volFecha || null);
  // Sólo para mostrar: el correlativo real lo asigna el servidor.
  const codigoPreview = yac ? armarCodigo("V", yac.codigo, proximoCorrelativo([0]), anio) : "";

  async function crear() {
    if (!yacimientoId) return;
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/voladuras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yacimiento_id: yacimientoId, vol_fecha: volFecha || null }),
    });
    const json = await res.json();
    if (!res.ok) {
      setGuardando(false);
      setError(json.error ?? "No se pudo crear.");
      return;
    }
    router.push(`/cantera/voladuras/${json.data.codigo}`);
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
      <h1 className="text-xl font-semibold">Nueva voladura</h1>
      <p className="mt-1 text-sm text-slate-500">
        El código se arma solo con la cantera y el año. La fecha de voladura es opcional; si no la
        sabés todavía, se usa el año en curso.
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
              <option key={y.id} value={y.id}>
                {y.nombre} · {y.material}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          Fecha de voladura <span className="text-slate-400">(opcional)</span>
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={volFecha}
            onChange={(e) => setVolFecha(e.target.value)}
          />
        </label>

        <p className="text-sm text-slate-500">
          Código: <span className="font-mono text-slate-800">{codigoPreview.replace(/V0+/, "V…")}</span>
          <span className="ml-1 text-xs">(el número lo asigna el sistema)</span>
        </p>

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
