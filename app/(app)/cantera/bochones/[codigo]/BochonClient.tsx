"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { montoBochon } from "@/lib/cantera/costos";
import type { Bochon, Yacimiento } from "@/lib/cantera/types";
import ConciliacionOdoo from "../../ConciliacionOdoo";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const money = (v: number | null) => (v === null ? "—" : `$ ${ars.format(v)}`);
const n = (v: string) => (v.trim() === "" ? null : Number(v));
const INPUT_CLS = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50";

function Campo({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  type?: string;
  mono?: boolean;
}) {
  return (
    <label className="text-xs text-slate-600">
      {label}
      <input
        type={type}
        className={`${INPUT_CLS} ${mono ? "font-mono" : ""}`}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export default function BochonClient({
  bochon,
  yacimiento,
  puedeEditar,
  puedeFacturar,
}: {
  bochon: Bochon;
  yacimiento: Yacimiento | null;
  puedeEditar: boolean;
  puedeFacturar: boolean;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const s = (v: number | null) => (v == null ? "" : String(v));
  const tx = (v: string | null) => v ?? "";

  const [f, setF] = useState({
    voladura_codigo: tx(bochon.voladura_codigo),
    fecha_voladura: tx(bochon.fecha_voladura),
    cantidad: s(bochon.cantidad),
    metros_perforados: s(bochon.metros_perforados),
    precio_usd_m: s(bochon.precio_usd_m),
    tc_usd: s(bochon.tc_usd),
    observaciones: tx(bochon.observaciones),
  });
  const set = (k: keyof typeof f) => (v: string) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setOk(false);
  };
  const dis = !puedeEditar;

  const monto = montoBochon({
    cantidad: n(f.cantidad),
    metrosPerforados: n(f.metros_perforados),
    precioUsdM: n(f.precio_usd_m),
    tc: n(f.tc_usd),
  });

  async function guardar() {
    setGuardando(true);
    setError("");
    const res = await fetch(`/api/cantera/bochones/${bochon.codigo}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setOk(true);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/cantera?y=${bochon.yacimiento_id}`} className="text-xs text-slate-500 underline">
            ← {yacimiento?.nombre ?? "Cantera"}
          </Link>
          <h1 className="font-mono text-xl font-semibold">{bochon.codigo}</h1>
        </div>
        {bochon.origen === "importacion" && (
          <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">de la planilla</span>
        )}
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {ok && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Guardado.</p>}

      <section className="mt-5 rounded-lg border border-slate-200 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Bochón</h2>
          <span className="text-sm font-medium">{money(monto)}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Campo label="Voladura asociada" value={f.voladura_codigo} onChange={set("voladura_codigo")} disabled={dis} mono />
          <Campo label="Fecha de voladura" type="date" value={f.fecha_voladura} onChange={set("fecha_voladura")} disabled={dis} />
          <Campo label="Cantidad de bochones" value={f.cantidad} onChange={set("cantidad")} disabled={dis} />
          <Campo label="Metros por bochón (≤1)" value={f.metros_perforados} onChange={set("metros_perforados")} disabled={dis} />
          <Campo label="Precio USD/m" value={f.precio_usd_m} onChange={set("precio_usd_m")} disabled={dis} />
          <Campo label="TC USD ($/USD)" value={f.tc_usd} onChange={set("tc_usd")} disabled={dis} />
        </div>
        <label className="mt-3 block text-xs text-slate-600">
          Observaciones
          <textarea className={INPUT_CLS} rows={2} disabled={dis} value={f.observaciones}
            onChange={(e) => set("observaciones")(e.target.value)} />
        </label>
        {puedeFacturar && (
          <ConciliacionOdoo
            titulo="Bochón"
            endpoint={`/api/cantera/bochones/${bochon.codigo}/conciliacion`}
            montoCalculado={monto}
            vinculado={{
              moveId: bochon.odoo_move_id,
              moveName: bochon.odoo_move_name,
              empresa: bochon.odoo_empresa,
              ref: bochon.odoo_ref,
              importe: bochon.odoo_importe,
              conforme: bochon.conforme,
              conformeObs: bochon.conforme_obs,
            }}
            onCambio={() => router.refresh()}
          />
        )}
      </section>

      {!dis && (
        <div className="mt-4">
          <button disabled={guardando} onClick={guardar}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
