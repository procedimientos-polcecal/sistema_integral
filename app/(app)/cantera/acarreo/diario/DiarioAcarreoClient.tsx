"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TIPOS_DE_ACARREO, ETIQUETA_UNIDAD } from "@/lib/cantera/acarreo";
import type { AcarreoDiarioDB } from "@/lib/cantera/types";

const INPUT_CLS = "w-28 rounded border border-slate-300 px-2 py-1 text-sm text-right disabled:bg-slate-50";

// Mismo filtro que `/cantera/acarreo/cargar`: sólo lo que no pesa la
// balanza. "Viaje de bloques" es el que de verdad importa acá — Planta 2 de
// Trituración lo usa como su indicador de acarreo, porque casi no tiene
// pesada propia con destino "PT 2" (9 en todo 2026).
const TIPOS_DIARIOS = TIPOS_DE_ACARREO.filter((t) => t.codigo === "viaje_de_bloques" || t.codigo === "horas_destape" || t.codigo === "hora_bochones");

export default function DiarioAcarreoClient({
  fecha, acarreos,
}: {
  fecha: string;
  acarreos: AcarreoDiarioDB[];
}) {
  const router = useRouter();
  const porTipo = new Map(acarreos.map((a) => [a.tipo, a]));

  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(TIPOS_DIARIOS.map((t) => [t.codigo, porTipo.get(t.codigo) ? String(porTipo.get(t.codigo)!.cantidad) : ""]))
  );
  const [guardandoTipo, setGuardandoTipo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [guardados, setGuardados] = useState<Set<string>>(new Set());

  function irA(fechaNueva: string) {
    router.push(`/cantera/acarreo/diario?fecha=${fechaNueva}`);
  }

  async function guardarTipo(tipo: string) {
    setGuardandoTipo(tipo);
    setError("");
    const cantidad = valores[tipo].trim() === "" ? 0 : Number(valores[tipo]);
    const res = await fetch("/api/cantera/acarreo-diario", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, fecha, cantidad }),
    });
    setGuardandoTipo(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setGuardados((prev) => new Set(prev).add(tipo));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cantera/acarreo" className="text-xs text-slate-500 underline">← Acarreo</Link>
      <h1 className="mt-1 text-xl font-semibold">Cargar por día</h1>
      <p className="mt-1 text-sm text-slate-500">
        Aparte del total mensual: esto es para que Trituración sepa cuánto llegó un día puntual. "Viaje de bloques" es el que se usa hoy en Planta 2. Guardar en 0 (o vacío) borra ese renglón.
      </p>

      <div className="mt-4">
        <input
          type="date" className="rounded border border-slate-300 px-2 py-1 text-sm"
          value={fecha} onChange={(e) => e.target.value && irA(e.target.value)}
        />
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 space-y-1">
        {TIPOS_DIARIOS.map((t) => (
          <div key={t.codigo} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
            <span className="text-sm text-slate-700">{t.etiqueta}</span>
            <div className="flex items-center gap-2">
              <input
                className={INPUT_CLS}
                value={valores[t.codigo]}
                onChange={(e) => {
                  setValores((prev) => ({ ...prev, [t.codigo]: e.target.value }));
                  setGuardados((prev) => { const n = new Set(prev); n.delete(t.codigo); return n; });
                }}
                placeholder="0"
              />
              <span className="w-10 text-xs text-slate-400">{ETIQUETA_UNIDAD[t.unidad]}</span>
              <button
                onClick={() => guardarTipo(t.codigo)}
                disabled={guardandoTipo === t.codigo}
                className="rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {guardandoTipo === t.codigo ? "…" : guardados.has(t.codigo) ? "✓" : "Guardar"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
