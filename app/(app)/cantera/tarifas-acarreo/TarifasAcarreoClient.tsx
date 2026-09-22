"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TIPOS_DE_ACARREO, ETIQUETA_UNIDAD, tipoDeAcarreo } from "@/lib/cantera/acarreo";
import type { TarifaAcarreoDB } from "@/lib/cantera/types";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const INPUT_CLS = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";

// Un tipo con `tarifaDe` (ej. "Horas de movimiento interno") no tiene
// tarifa propia: usa la del tipo que declara, así que no tiene sentido
// poder cargarle una acá — quedaría guardada y nunca se leería.
const TIPOS_CON_TARIFA_PROPIA = TIPOS_DE_ACARREO.filter((t) => !t.tarifaDe);

export default function TarifasAcarreoClient({ tarifas }: { tarifas: TarifaAcarreoDB[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [alta, setAlta] = useState({ tipo: TIPOS_CON_TARIFA_PROPIA[0].codigo, desde: "", tarifa: "" });

  const porTipo = new Map<string, TarifaAcarreoDB[]>();
  for (const t of tarifas) {
    const lista = porTipo.get(t.tipo) ?? [];
    lista.push(t);
    porTipo.set(t.tipo, lista);
  }

  async function crear() {
    const tarifa = Number(alta.tarifa);
    if (!alta.desde || !isFinite(tarifa) || tarifa <= 0) {
      setError("Faltan la fecha desde o la tarifa.");
      return;
    }
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/tarifas-acarreo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: alta.tipo, desde: alta.desde, tarifa }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setAlta({ tipo: alta.tipo, desde: "", tarifa: "" });
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <h1 className="mt-1 text-xl font-semibold">Tarifas de acarreo</h1>
      <p className="mt-1 text-sm text-slate-500">
        Cambian cada dos meses. Cargar una tarifa nueva cierra automáticamente la vigencia anterior del mismo tipo.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 space-y-3">
        {TIPOS_CON_TARIFA_PROPIA.map((t) => {
          const historial = (porTipo.get(t.codigo) ?? []).sort((a, b) => b.desde.localeCompare(a.desde));
          return (
            <div key={t.codigo} className="card p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">{t.etiqueta}</span>
                <span className="text-xs text-slate-400">$/{ETIQUETA_UNIDAD[t.unidad]}</span>
              </div>
              {historial.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700">Sin tarifa cargada — el acarreo de este tipo queda sin monto.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {historial.map((h) => (
                    <li key={h.id}>
                      desde {h.desde} {h.hasta ? `hasta ${h.hasta}` : "(vigente)"}: <span className="font-medium">$ {ars.format(h.tarifa)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 card p-4">
        <h2 className="text-sm font-semibold">Cargar tarifa nueva</h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="text-xs text-slate-600">
            Tipo
            <select className={INPUT_CLS} value={alta.tipo} onChange={(e) => setAlta({ ...alta, tipo: e.target.value })}>
              {TIPOS_CON_TARIFA_PROPIA.map((t) => (
                <option key={t.codigo} value={t.codigo}>{t.etiqueta}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Vigente desde
            <input type="date" className={INPUT_CLS} value={alta.desde} onChange={(e) => setAlta({ ...alta, desde: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">
            Tarifa ($/{ETIQUETA_UNIDAD[tipoDeAcarreo(alta.tipo)?.unidad ?? "tonelada"]})
            <input className={INPUT_CLS} value={alta.tarifa} onChange={(e) => setAlta({ ...alta, tarifa: e.target.value })} />
          </label>
        </div>
        <button disabled={guardando} onClick={crear} className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50">
          {guardando ? "Guardando…" : "Cargar tarifa"}
        </button>
      </div>
    </div>
  );
}
