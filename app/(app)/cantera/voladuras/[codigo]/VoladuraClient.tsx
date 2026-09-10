"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { montoPerforacion, montoVoladura, metrosPerforados } from "@/lib/cantera/costos";
import { toneladasEstimadas, desvioContraPlanilla } from "@/lib/cantera/toneladas";
import { faltaDesglose } from "@/lib/cantera/consumos";
import { ETIQUETA_TIPO_CONSUMO } from "@/lib/cantera/vocabulario";
import type { Consumo, Insumo, Voladura, Yacimiento } from "@/lib/cantera/types";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const money = (v: number | null) => (v === null ? "—" : `$ ${ars.format(v)}`);
const n = (v: string) => (v.trim() === "" ? null : Number(v));
const INPUT_CLS = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50";

/**
 * Fuera del componente a propósito: definido adentro, cada tecleo re-crea el
 * tipo del componente y React desmonta el input, y se pierde el foco.
 */
function Campo({
  label,
  value,
  onChange,
  disabled,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  type?: string;
}) {
  return (
    <label className="text-xs text-slate-600">
      {label}
      <input
        type={type}
        className={INPUT_CLS}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

interface RenglonUI {
  insumo_id: string;
  insumo_raw: string;
  tipo: string;
  cantidad: string;
  precio_usd: string;
}

function aRenglon(c: Consumo): RenglonUI {
  return {
    insumo_id: c.insumo_id ?? "",
    insumo_raw: c.insumo_raw ?? "",
    tipo: c.tipo ?? "otros_insumos",
    cantidad: c.cantidad == null ? "" : String(c.cantidad),
    precio_usd: c.precio_usd == null ? "" : String(c.precio_usd),
  };
}

export default function VoladuraClient({
  voladura,
  yacimiento,
  consumos,
  insumos,
  puedeEditar,
}: {
  voladura: Voladura;
  yacimiento: Yacimiento | null;
  consumos: Consumo[];
  insumos: Insumo[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const t = (v: string | null) => v ?? "";
  const s = (v: number | null) => (v == null ? "" : String(v));

  const [f, setF] = useState({
    perf_inicio: t(voladura.perf_inicio),
    perf_fin: t(voladura.perf_fin),
    pozos: s(voladura.pozos),
    metros_por_pozo: s(voladura.metros_por_pozo),
    burden_m: s(voladura.burden_m),
    espaciamiento_m: s(voladura.espaciamiento_m),
    perf_precio_usd_m: s(voladura.perf_precio_usd_m),
    perf_tc_usd: s(voladura.perf_tc_usd),
    vol_fecha_carga: t(voladura.vol_fecha_carga),
    vol_fecha: t(voladura.vol_fecha),
    vol_pozos: s(voladura.vol_pozos),
    vol_metros_por_pozo: s(voladura.vol_metros_por_pozo),
    vol_burden_m: s(voladura.vol_burden_m),
    vol_espaciamiento_m: s(voladura.vol_espaciamiento_m),
    vol_tc_usd: s(voladura.vol_tc_usd),
    explosivos_raw: t(voladura.explosivos_raw),
    observaciones: t(voladura.observaciones),
  });
  const set = (k: keyof typeof f) => (v: string) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setOk(false);
  };

  const [renglones, setRenglones] = useState<RenglonUI[]>(consumos.map(aRenglon));

  const metros = metrosPerforados(n(f.pozos), n(f.metros_por_pozo));
  const montoPerf = montoPerforacion({
    pozos: n(f.pozos),
    metrosPorPozo: n(f.metros_por_pozo),
    precioUsdM: n(f.perf_precio_usd_m),
    tc: n(f.perf_tc_usd),
  });

  const consumoParaMonto = useMemo(
    () => renglones.map((r) => ({ cantidad: n(r.cantidad), precio_usd: n(r.precio_usd) })),
    [renglones]
  );
  const montoVol = montoVoladura(consumoParaMonto, n(f.vol_tc_usd));

  const toneladas = toneladasEstimadas({
    pozos: n(f.vol_pozos) ?? n(f.pozos),
    metrosPorPozo: n(f.vol_metros_por_pozo) ?? n(f.metros_por_pozo),
    densidad: yacimiento?.densidad_t_m3 ?? null,
    burden: n(f.vol_burden_m) ?? n(f.burden_m) ?? yacimiento?.burden_m ?? null,
    espaciamiento: n(f.vol_espaciamiento_m) ?? n(f.espaciamiento_m) ?? yacimiento?.espaciamiento_m ?? null,
  });
  const desvio = desvioContraPlanilla(toneladas, voladura.toneladas_planilla);

  function actualizarRenglon(i: number, cambios: Partial<RenglonUI>) {
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, ...cambios } : r)));
    setOk(false);
  }
  function elegirInsumo(i: number, insumoId: string) {
    const ins = insumos.find((x) => x.id === insumoId);
    actualizarRenglon(i, {
      insumo_id: insumoId,
      insumo_raw: "",
      tipo: ins?.tipo ?? renglones[i].tipo,
      precio_usd: ins?.precio_usd != null ? String(ins.precio_usd) : renglones[i].precio_usd,
    });
  }

  async function guardar() {
    setGuardando(true);
    setError("");
    const res = await fetch(`/api/cantera/voladuras/${voladura.codigo}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...f,
        consumos: renglones.map((r) => ({
          insumo_id: r.insumo_id || null,
          insumo_raw: r.insumo_raw || null,
          tipo: r.tipo,
          cantidad: n(r.cantidad),
          precio_usd: n(r.precio_usd),
        })),
      }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "No se pudo guardar.");
      return;
    }
    setOk(true);
    router.refresh();
  }

  const dis = !puedeEditar;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/cantera?y=${voladura.yacimiento_id}`} className="text-xs text-slate-500 underline">
            ← {yacimiento?.nombre ?? "Cantera"}
          </Link>
          <h1 className="font-mono text-xl font-semibold">{voladura.codigo}</h1>
        </div>
        {voladura.origen === "importacion" && (
          <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">de la planilla</span>
        )}
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {ok && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Guardado.</p>}

      {/* ── Perforación ── */}
      <section className="mt-5 rounded-lg border border-slate-200 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Perforación</h2>
          <span className="text-sm">
            {metros != null && <span className="text-slate-500">{num1.format(metros)} m · </span>}
            <span className="font-medium">{money(montoPerf)}</span>
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo label="Inicio" type="date" value={f.perf_inicio} onChange={set("perf_inicio")} disabled={dis} />
          <Campo label="Fin" type="date" value={f.perf_fin} onChange={set("perf_fin")} disabled={dis} />
          <Campo label="Cant. de pozos" value={f.pozos} onChange={set("pozos")} disabled={dis} />
          <Campo label="Metros por pozo" value={f.metros_por_pozo} onChange={set("metros_por_pozo")} disabled={dis} />
          <Campo label="Burden (m)" value={f.burden_m} onChange={set("burden_m")} disabled={dis} />
          <Campo label="Espaciamiento (m)" value={f.espaciamiento_m} onChange={set("espaciamiento_m")} disabled={dis} />
          <Campo label="Precio USD/m" value={f.perf_precio_usd_m} onChange={set("perf_precio_usd_m")} disabled={dis} />
          <Campo label="TC USD ($/USD)" value={f.perf_tc_usd} onChange={set("perf_tc_usd")} disabled={dis} />
        </div>
      </section>

      {/* ── Voladura ── */}
      <section className="mt-4 rounded-lg border border-slate-200 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Voladura</h2>
          <span className="text-sm">
            {toneladas != null && (
              <span className={desvio.fueraDeRango ? "text-amber-700" : "text-slate-500"}>
                {num1.format(toneladas)} t
                {voladura.toneladas_planilla != null && ` (planilla ${num1.format(voladura.toneladas_planilla)})`}
                {" · "}
              </span>
            )}
            <span className="font-medium">{money(montoVol)}</span>
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo label="Fecha carga explosivo" type="date" value={f.vol_fecha_carga} onChange={set("vol_fecha_carga")} disabled={dis} />
          <Campo label="Fecha de voladura" type="date" value={f.vol_fecha} onChange={set("vol_fecha")} disabled={dis} />
          <Campo label="Pozos volados" value={f.vol_pozos} onChange={set("vol_pozos")} disabled={dis} />
          <Campo label="Metros por pozo" value={f.vol_metros_por_pozo} onChange={set("vol_metros_por_pozo")} disabled={dis} />
          <Campo label="Burden real (m)" value={f.vol_burden_m} onChange={set("vol_burden_m")} disabled={dis} />
          <Campo label="Espaciam. real (m)" value={f.vol_espaciamiento_m} onChange={set("vol_espaciamiento_m")} disabled={dis} />
          <Campo label="TC USD ($/USD)" value={f.vol_tc_usd} onChange={set("vol_tc_usd")} disabled={dis} />
        </div>
        <label className="mt-3 block text-xs text-slate-600">
          Explosivos (texto libre, como en la planilla)
          <input
            className={INPUT_CLS}
            disabled={dis}
            value={f.explosivos_raw}
            onChange={(e) => set("explosivos_raw")(e.target.value)}
            placeholder="emulex x 60 mm: 48,5 - anfo premium: 520"
          />
        </label>
        {faltaDesglose(f.explosivos_raw, renglones) && (
          <p className="mt-1 text-xs text-amber-700">
            Hay texto de explosivos pero ningún renglón de consumo: el monto de la voladura queda sin calcular.
          </p>
        )}
      </section>

      {/* ── Consumos ── */}
      <section className="mt-4 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold">Consumos</h2>
        <p className="text-xs text-slate-500">
          De acá sale el monto de la voladura. El precio prellena del catálogo y se puede pisar.
        </p>
        <div className="mt-3 space-y-2">
          {renglones.map((r, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <select
                className="col-span-4 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                disabled={dis}
                value={r.insumo_id}
                onChange={(e) => elegirInsumo(i, e.target.value)}
              >
                <option value="">— insumo del catálogo —</option>
                {insumos.map((ins) => (
                  <option key={ins.id} value={ins.id}>{ins.nombre}</option>
                ))}
              </select>
              {r.insumo_id === "" ? (
                <input
                  className="col-span-3 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                  disabled={dis}
                  placeholder="o escribilo"
                  value={r.insumo_raw}
                  onChange={(e) => actualizarRenglon(i, { insumo_raw: e.target.value })}
                />
              ) : (
                <span className="col-span-3 text-xs text-slate-400">
                  {ETIQUETA_TIPO_CONSUMO[r.tipo as keyof typeof ETIQUETA_TIPO_CONSUMO] ?? r.tipo}
                </span>
              )}
              <input
                className="col-span-2 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                disabled={dis}
                placeholder="cant."
                value={r.cantidad}
                onChange={(e) => actualizarRenglon(i, { cantidad: e.target.value })}
              />
              <input
                className="col-span-2 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                disabled={dis}
                placeholder="USD"
                value={r.precio_usd}
                onChange={(e) => actualizarRenglon(i, { precio_usd: e.target.value })}
              />
              {!dis && (
                <button
                  onClick={() => setRenglones((prev) => prev.filter((_, j) => j !== i))}
                  className="col-span-1 text-slate-400 hover:text-red-600"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {!dis && (
          <button
            onClick={() =>
              setRenglones((prev) => [
                ...prev,
                { insumo_id: "", insumo_raw: "", tipo: "otros_insumos", cantidad: "", precio_usd: "" },
              ])
            }
            className="mt-2 text-sm text-slate-600 underline"
          >
            + agregar renglón
          </button>
        )}
      </section>

      <section className="mt-4">
        <label className="block text-xs text-slate-600">
          Observaciones
          <textarea
            className={INPUT_CLS}
            rows={2}
            disabled={dis}
            value={f.observaciones}
            onChange={(e) => set("observaciones")(e.target.value)}
          />
        </label>
      </section>

      {!dis && (
        <div className="mt-4">
          <button
            disabled={guardando}
            onClick={guardar}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
