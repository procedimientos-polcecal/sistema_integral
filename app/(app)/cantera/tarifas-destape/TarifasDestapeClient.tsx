"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CATEGORIAS_DE_TARIFA, ETIQUETA_TIPO_CAMION, TIPOS_DE_CAMION, type CategoriaDeTarifa } from "@/lib/cantera/destape";
import type { TarifaDestapeDB } from "@/lib/cantera/types";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const INPUT_CLS = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";

const ETIQUETA_CATEGORIA: Record<CategoriaDeTarifa, string> = {
  fletero_externo: "Fletero externo (por tipo de camión)",
};

export default function TarifasDestapeClient({
  tarifas,
}: {
  tarifas: TarifaDestapeDB[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [alta, setAlta] = useState<{ categoria: CategoriaDeTarifa; clave: string; desde: string; tarifa: string }>({
    categoria: "fletero_externo", clave: "", desde: "", tarifa: "",
  });

  const porCategoriaClave = new Map<string, TarifaDestapeDB[]>();
  for (const t of tarifas) {
    const clave = `${t.categoria}|${t.clave}`;
    const lista = porCategoriaClave.get(clave) ?? [];
    lista.push(t);
    porCategoriaClave.set(clave, lista);
  }
  const gruposConHistorial = [...porCategoriaClave.entries()].sort(([a], [b]) => a.localeCompare(b));

  async function crear() {
    const tarifa = Number(alta.tarifa);
    if (!alta.clave || !alta.desde || !isFinite(tarifa) || tarifa <= 0) {
      setError("Faltan la clave, la fecha desde o la tarifa.");
      return;
    }
    setGuardando(true);
    setError("");
    const res = await fetch("/api/cantera/tarifas-destape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoria: alta.categoria, clave: alta.clave, desde: alta.desde, tarifa }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setAlta({ ...alta, desde: "", tarifa: "" });
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/cantera/destape" className="text-xs text-slate-500 underline">← Destape</Link>
      <h1 className="mt-1 text-xl font-semibold">Tarifas de destape</h1>
      <p className="mt-1 text-sm text-slate-500">
        Cargar una tarifa nueva cierra automáticamente la vigencia anterior de esa categoría+clave.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 space-y-3">
        {gruposConHistorial.length === 0 && (
          <p className="text-sm text-amber-700">
            Sin ninguna tarifa cargada todavía — el costo de un fletero externo va a dar $0. (Mano de obra y máquina
            propia no van acá: se calculan solas.)
          </p>
        )}
        {gruposConHistorial.map(([clave, historial]) => {
          const [categoria, valorClave] = clave.split("|");
          const historialOrdenado = [...historial].sort((a, b) => b.desde.localeCompare(a.desde));
          return (
            <div key={clave} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">{ETIQUETA_CATEGORIA[categoria as CategoriaDeTarifa]} — {valorClave}</span>
                <span className="text-xs text-slate-400">$/h</span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {historialOrdenado.map((h) => (
                  <li key={h.id}>
                    desde {h.desde} {h.hasta ? `hasta ${h.hasta}` : "(vigente)"}: <span className="font-medium">$ {ars.format(h.tarifa)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold">Cargar tarifa nueva</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-xs text-slate-600">
            Categoría
            <select
              className={INPUT_CLS} value={alta.categoria}
              onChange={(e) => setAlta({ ...alta, categoria: e.target.value as CategoriaDeTarifa, clave: "" })}
            >
              {CATEGORIAS_DE_TARIFA.map((c) => <option key={c} value={c}>{ETIQUETA_CATEGORIA[c]}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Clave
            <select className={INPUT_CLS} value={alta.clave} onChange={(e) => setAlta({ ...alta, clave: e.target.value })}>
              <option value="">Elegir tipo de camión...</option>
              {TIPOS_DE_CAMION.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO_CAMION[t]}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Vigente desde
            <input type="date" className={INPUT_CLS} value={alta.desde} onChange={(e) => setAlta({ ...alta, desde: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">
            Tarifa ($/h)
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
