"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ETIQUETA_TIPO_CAMION, TIPOS_DE_CAMION } from "@/lib/cantera/destape";
import type { CapacidadFleteroDB, Fletero } from "@/lib/cantera/types";

const INPUT_CLS = "w-24 rounded border border-slate-300 px-2 py-1 text-sm text-right";

export default function CapacidadesFleteroClient({
  fleteros, capacidades,
}: {
  fleteros: Fletero[];
  capacidades: CapacidadFleteroDB[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [guardandoClave, setGuardandoClave] = useState<string | null>(null);

  const porFleteroTipo = new Map(capacidades.map((c) => [`${c.fletero_id}|${c.tipo_camion}`, c]));
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(
      fleteros.flatMap((f) => TIPOS_DE_CAMION.map((t) => {
        const clave = `${f.id}|${t}`;
        const existente = porFleteroTipo.get(clave);
        return [clave, existente ? String(existente.toneladas_por_viaje) : ""];
      }))
    )
  );

  async function guardar(fleteroId: string, tipoCamion: string) {
    const clave = `${fleteroId}|${tipoCamion}`;
    const toneladas = valores[clave].trim() === "" ? 0 : Number(valores[clave]);
    setGuardandoClave(clave);
    setError("");
    const res = await fetch("/api/cantera/capacidades-fletero", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fletero_id: fleteroId, tipo_camion: tipoCamion, toneladas_por_viaje: toneladas }),
    });
    setGuardandoClave(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cantera/destape" className="text-xs text-slate-500 underline">← Destape</Link>
      <h1 className="mt-1 text-xl font-semibold">Capacidades de fletero</h1>
      <p className="mt-1 text-sm text-slate-500">
        Toneladas por viaje, para estimar lo transportado sin pesada. 0 = sin relevar todavía, no "no transporta nada".
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <th className="px-3 py-2">Fletero</th>
              {TIPOS_DE_CAMION.map((t) => <th key={t} className="px-3 py-2 text-right">{ETIQUETA_TIPO_CAMION[t]} (t/viaje)</th>)}
            </tr>
          </thead>
          <tbody>
            {fleteros.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{f.nombre}</td>
                {TIPOS_DE_CAMION.map((t) => {
                  const clave = `${f.id}|${t}`;
                  return (
                    <td key={t} className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          className={INPUT_CLS}
                          value={valores[clave]}
                          onChange={(e) => setValores((prev) => ({ ...prev, [clave]: e.target.value }))}
                          placeholder="0"
                        />
                        <button
                          onClick={() => guardar(f.id, t)}
                          disabled={guardandoClave === clave}
                          className="rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          {guardandoClave === clave ? "…" : "✓"}
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
