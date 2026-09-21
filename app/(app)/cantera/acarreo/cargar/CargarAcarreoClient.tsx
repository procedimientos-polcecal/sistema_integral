"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TIPOS_DE_ACARREO, ETIQUETA_UNIDAD } from "@/lib/cantera/acarreo";
import type { AcarreoDB, Fletero } from "@/lib/cantera/types";

const INPUT_CLS = "w-28 rounded border border-slate-300 px-2 py-1 text-sm text-right disabled:bg-slate-50";
const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

// El material (toneladas) se cuenta solo desde las pesadas de balanza — sólo
// lo que no pasa por la balanza (horas, viajes) se carga a mano acá. La
// excepción es "Materiales Pezzuchi": es tonelada pero no es piedra propia
// pesada en la cantera, sino que llega de un tercero (Pezzuchi) y no pasa por
// la balanza de "Datos" — en la planilla real también se carga a mano en
// "Ingreso de Datos", nunca sale de una pesada.
const TIPOS_MANUALES = TIPOS_DE_ACARREO.filter((t) => t.unidad !== "tonelada" || t.codigo === "materiales_pezzuchi");

export default function CargarAcarreoClient({
  fleteros, fleteroId, fecha, acarreosDelMes,
}: {
  fleteros: Fletero[];
  fleteroId: string;
  fecha: string;
  acarreosDelMes: AcarreoDB[];
}) {
  const router = useRouter();
  const deEsteDia = new Map(acarreosDelMes.filter((a) => a.fecha === fecha).map((a) => [a.tipo, a]));

  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(TIPOS_MANUALES.map((t) => [t.codigo, deEsteDia.get(t.codigo) ? String(deEsteDia.get(t.codigo)!.cantidad) : ""]))
  );
  const [guardandoTipo, setGuardandoTipo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [guardados, setGuardados] = useState<Set<string>>(new Set());

  function irCon(cambios: Record<string, string>) {
    const p = new URLSearchParams({ fletero: fleteroId, fecha, ...cambios });
    router.push(`/cantera/acarreo/cargar?${p.toString()}`);
  }

  async function guardarTipo(tipo: string) {
    setGuardandoTipo(tipo);
    setError("");
    const cantidad = valores[tipo].trim() === "" ? 0 : Number(valores[tipo]);
    const res = await fetch("/api/cantera/acarreos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fletero_id: fleteroId, tipo, fecha, cantidad }),
    });
    setGuardandoTipo(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setGuardados((prev) => new Set(prev).add(tipo));
    router.refresh();
  }

  async function borrarEntrada(a: AcarreoDB) {
    setError("");
    const res = await fetch("/api/cantera/acarreos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fletero_id: a.fletero_id, tipo: a.tipo, fecha: a.fecha, cantidad: 0 }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo borrar.");
      return;
    }
    router.refresh();
  }

  if (fleteros.length === 0) {
    return (
      <p className="mx-auto max-w-lg text-center text-sm text-slate-500">
        Primero hay que cargar fleteros en <Link href="/cantera/fleteros" className="underline">Fleteros</Link>.
      </p>
    );
  }

  const mes = fecha.slice(0, 7);
  const totalesPorTipo = new Map<string, number>();
  for (const a of acarreosDelMes) totalesPorTipo.set(a.tipo, (totalesPorTipo.get(a.tipo) ?? 0) + a.cantidad);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/cantera/acarreo" className="text-xs text-slate-500 underline">← Acarreo</Link>
      <h1 className="mt-1 text-xl font-semibold">Cargar datos</h1>
      <p className="mt-1 text-sm text-slate-500">Sólo lo que no pesa la balanza: horas y viajes, día por día. El material sale solo de las pesadas de balanza. Guardar en 0 (o vacío) borra ese día.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <select className="rounded border border-slate-300 px-2 py-1" value={fleteroId} onChange={(e) => irCon({ fletero: e.target.value })}>
          {fleteros.map((f) => (
            <option key={f.id} value={f.id}>{f.nombre}</option>
          ))}
        </select>
        <input type="date" className="rounded border border-slate-300 px-2 py-1" value={fecha} onChange={(e) => e.target.value && irCon({ fecha: e.target.value })} />
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

      {/* ── Lo cargado este mes, para revisar/corregir un día anterior ── */}
      <h2 className="mt-6 text-sm font-semibold text-slate-700">Cargado en {mes}</h2>
      {acarreosDelMes.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">Nada cargado todavía este mes para este fletero.</p>
      ) : (
        <div className="mt-2 space-y-3">
          {TIPOS_MANUALES.filter((t) => totalesPorTipo.has(t.codigo)).map((t) => {
            const entradas = acarreosDelMes.filter((a) => a.tipo === t.codigo).sort((a, b) => a.fecha.localeCompare(b.fecha));
            return (
              <div key={t.codigo}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-slate-600">{t.etiqueta}</span>
                  <span className="text-slate-400">Total: {num.format(totalesPorTipo.get(t.codigo)!)} {ETIQUETA_UNIDAD[t.unidad]}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {entradas.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => irCon({ fecha: a.fecha })}
                      className="group flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs hover:border-slate-300"
                      title="Ir a este día"
                    >
                      {a.fecha.slice(8, 10)}/{a.fecha.slice(5, 7)}: {num.format(a.cantidad)}
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); borrarEntrada(a); }}
                        className="text-slate-300 group-hover:text-red-500"
                        title="Borrar"
                      >
                        ✕
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
