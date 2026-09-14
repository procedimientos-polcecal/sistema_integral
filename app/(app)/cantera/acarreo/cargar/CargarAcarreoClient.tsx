"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TIPOS_DE_ACARREO, ETIQUETA_UNIDAD } from "@/lib/cantera/acarreo";
import type { AcarreoDB, Fletero } from "@/lib/cantera/types";

const INPUT_CLS = "w-28 rounded border border-slate-300 px-2 py-1 text-sm text-right disabled:bg-slate-50";

// El material (toneladas) se cuenta solo desde las pesadas de balanza — sólo
// lo que no pasa por la balanza (horas, viajes) se carga a mano acá.
const TIPOS_MANUALES = TIPOS_DE_ACARREO.filter((t) => t.unidad !== "tonelada");

export default function CargarAcarreoClient({
  fleteros,
  fleteroId,
  mes,
  acarreos,
}: {
  fleteros: Fletero[];
  fleteroId: string;
  mes: string;
  acarreos: AcarreoDB[];
}) {
  const router = useRouter();
  const porTipo = new Map(acarreos.map((a) => [a.tipo, a]));

  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(TIPOS_MANUALES.map((t) => [t.codigo, porTipo.get(t.codigo) ? String(porTipo.get(t.codigo)!.cantidad) : ""]))
  );
  const [guardandoTipo, setGuardandoTipo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [guardados, setGuardados] = useState<Set<string>>(new Set());

  function irCon(cambios: Record<string, string>) {
    const p = new URLSearchParams({ fletero: fleteroId, mes, ...cambios });
    router.push(`/cantera/acarreo/cargar?${p.toString()}`);
  }

  async function guardarTipo(tipo: string) {
    setGuardandoTipo(tipo);
    setError("");
    const cantidad = valores[tipo].trim() === "" ? 0 : Number(valores[tipo]);
    const res = await fetch("/api/cantera/acarreos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fletero_id: fleteroId, tipo, mes, cantidad }),
    });
    setGuardandoTipo(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setGuardados((prev) => new Set(prev).add(tipo));
    router.refresh();
  }

  if (fleteros.length === 0) {
    return (
      <p className="mx-auto max-w-lg text-center text-sm text-slate-500">
        Primero hay que cargar fleteros en <Link href="/cantera/fleteros" className="underline">Fleteros</Link>.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cantera/acarreo" className="text-xs text-slate-500 underline">← Acarreo</Link>
      <h1 className="mt-1 text-xl font-semibold">Cargar acarreo</h1>
      <p className="mt-1 text-sm text-slate-500">Sólo lo que no pesa la balanza: horas y viajes. El material sale solo de las pesadas de balanza. Guardar en 0 (o vacío) borra ese renglón.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <select className="rounded border border-slate-300 px-2 py-1" value={fleteroId} onChange={(e) => irCon({ fletero: e.target.value })}>
          {fleteros.map((f) => (
            <option key={f.id} value={f.id}>{f.nombre}</option>
          ))}
        </select>
        <input type="month" className="rounded border border-slate-300 px-2 py-1" value={mes} onChange={(e) => e.target.value && irCon({ mes: e.target.value })} />
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 space-y-1">
        {TIPOS_MANUALES.map((t) => (
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
