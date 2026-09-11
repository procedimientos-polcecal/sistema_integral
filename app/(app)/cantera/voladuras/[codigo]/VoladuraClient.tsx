"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  baseDeConsumosUsd,
  montoPerforacion,
  montoVoladura,
  TASA_SERVICIO_VOLADURA,
} from "@/lib/cantera/costos";
import { toneladasEstimadas, desvioContraPlanilla } from "@/lib/cantera/toneladas";
import { totalMetros, totalPozos, type Tramo } from "@/lib/cantera/tramos";
import { ETIQUETA_TIPO_CONSUMO } from "@/lib/cantera/vocabulario";
import type { Consumo, Insumo, Voladura, Yacimiento } from "@/lib/cantera/types";
import ConciliacionOdoo from "../../ConciliacionOdoo";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const money = (v: number | null) => (v === null ? "—" : `$ ${ars.format(v)}`);
const n = (v: string) => (v.trim() === "" ? null : Number(v));
const INPUT_CLS = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50";

/** Fuera del componente: definido adentro, cada tecleo desmonta el input y se pierde el foco. */
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
      <input type={type} className={INPUT_CLS} disabled={disabled} value={value}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

interface TramoUI {
  pozos: string;
  metros: string;
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

/** Los tramos guardados, o uno solo con el promedio escalar, para el estado inicial. */
function tramosIniciales(
  tramos: Tramo[] | null,
  pozos: number | null,
  metrosPorPozo: number | null
): TramoUI[] {
  if (tramos && tramos.length) return tramos.map((t) => ({ pozos: String(t.pozos), metros: String(t.metros) }));
  if (pozos != null && metrosPorPozo != null) return [{ pozos: String(pozos), metros: String(metrosPorPozo) }];
  return [];
}

/** Un `TramoUI[]` a `Tramo[]` limpio (descarta filas incompletas o inválidas). */
function tramosLimpios(filas: TramoUI[]): Tramo[] {
  const out: Tramo[] = [];
  for (const f of filas) {
    const p = Number(f.pozos);
    const m = Number(f.metros.replace(",", "."));
    if (Number.isInteger(p) && p > 0 && isFinite(m) && m > 0) out.push({ pozos: p, metros: m });
  }
  return out;
}

/** Un editor de tramos: filas de [cant. de pozos] × [metros por pozo]. */
function GrillaTramos({
  filas,
  setFilas,
  disabled,
}: {
  filas: TramoUI[];
  setFilas: (f: TramoUI[]) => void;
  disabled: boolean;
}) {
  const limpios = tramosLimpios(filas);
  return (
    <div className="mt-1">
      <div className="space-y-1">
        {filas.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
              disabled={disabled}
              placeholder="pozos"
              value={r.pozos}
              onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, pozos: e.target.value } : x)))}
            />
            <span className="text-slate-400">×</span>
            <input
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
              disabled={disabled}
              placeholder="metros"
              value={r.metros}
              onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, metros: e.target.value } : x)))}
            />
            {!disabled && (
              <button
                onClick={() => setFilas(filas.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-600"
                aria-label="Quitar"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          onClick={() => setFilas([...filas, { pozos: "", metros: "" }])}
          className="mt-1 text-sm text-slate-600 underline"
        >
          + agregar línea
        </button>
      )}
      {limpios.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {totalPozos(limpios)} pozos · {num1.format(totalMetros(limpios))} m perforados
        </p>
      )}
    </div>
  );
}

export default function VoladuraClient({
  voladura,
  yacimiento,
  consumos,
  insumos,
  puedeEditar,
  puedeFacturar,
}: {
  voladura: Voladura;
  yacimiento: Yacimiento | null;
  consumos: Consumo[];
  insumos: Insumo[];
  puedeEditar: boolean;
  puedeFacturar: boolean;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const tx = (v: string | null) => v ?? "";
  const s = (v: number | null) => (v == null ? "" : String(v));

  const [f, setF] = useState({
    perf_inicio: tx(voladura.perf_inicio),
    perf_fin: tx(voladura.perf_fin),
    burden_m: s(voladura.burden_m),
    espaciamiento_m: s(voladura.espaciamiento_m),
    perf_precio_usd_m: s(voladura.perf_precio_usd_m),
    perf_tc_usd: s(voladura.perf_tc_usd),
    perf_noches_sereno: s(voladura.perf_noches_sereno),
    perf_monto_noche: s(voladura.perf_monto_noche),
    material: tx(voladura.material),
    densidad_t_m3: s(voladura.densidad_t_m3),
    vol_fecha_carga: tx(voladura.vol_fecha_carga),
    vol_fecha: tx(voladura.vol_fecha),
    vol_burden_m: s(voladura.vol_burden_m),
    vol_espaciamiento_m: s(voladura.vol_espaciamiento_m),
    vol_tc_usd: s(voladura.vol_tc_usd),
    observaciones: tx(voladura.observaciones),
  });
  const set = (k: keyof typeof f) => (v: string) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setOk(false);
  };

  const [perfFilas, setPerfFilas] = useState<TramoUI[]>(
    tramosIniciales(voladura.perf_tramos, voladura.pozos, voladura.metros_por_pozo)
  );
  const [volFilas, setVolFilas] = useState<TramoUI[]>(
    tramosIniciales(voladura.vol_tramos, voladura.vol_pozos, voladura.vol_metros_por_pozo)
  );
  const [renglones, setRenglones] = useState<RenglonUI[]>(consumos.map(aRenglon));

  const perfTramos = tramosLimpios(perfFilas);
  const volTramos = tramosLimpios(volFilas);
  const perfMetros = perfTramos.length ? totalMetros(perfTramos) : null;
  const volMetros = volTramos.length ? totalMetros(volTramos) : perfMetros;

  const montoPerf = montoPerforacion({
    metros: perfMetros,
    precioUsdM: n(f.perf_precio_usd_m),
    tc: n(f.perf_tc_usd),
    nochesSereno: n(f.perf_noches_sereno),
    montoNoche: n(f.perf_monto_noche),
  });

  const consumoParaMonto = useMemo(
    () => renglones.map((r) => ({ cantidad: n(r.cantidad), precio_usd: n(r.precio_usd), tipo: r.tipo })),
    [renglones]
  );
  const baseUsd = baseDeConsumosUsd(consumoParaMonto);
  const servicioUsd = baseUsd * TASA_SERVICIO_VOLADURA;
  const montoVol = montoVoladura(consumoParaMonto, n(f.vol_tc_usd));

  const densidadEfectiva = n(f.densidad_t_m3) ?? yacimiento?.densidad_t_m3 ?? null;
  const toneladas = toneladasEstimadas({
    metros: volMetros,
    densidad: densidadEfectiva,
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
        perf_inicio: f.perf_inicio,
        perf_fin: f.perf_fin,
        perf_tramos: perfTramos.length ? perfTramos : null,
        burden_m: f.burden_m,
        espaciamiento_m: f.espaciamiento_m,
        perf_precio_usd_m: f.perf_precio_usd_m,
        perf_tc_usd: f.perf_tc_usd,
        perf_noches_sereno: f.perf_noches_sereno,
        perf_monto_noche: f.perf_monto_noche,
        material: f.material,
        densidad_t_m3: f.densidad_t_m3,
        vol_fecha_carga: f.vol_fecha_carga,
        vol_fecha: f.vol_fecha,
        vol_tramos: volTramos.length ? volTramos : null,
        vol_burden_m: f.vol_burden_m,
        vol_espaciamiento_m: f.vol_espaciamiento_m,
        vol_tc_usd: f.vol_tc_usd,
        observaciones: f.observaciones,
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
          <Link href={`/cantera/registros?y=${voladura.yacimiento_id}`} className="text-xs text-slate-500 underline">
            ← {yacimiento?.nombre ?? "Registros"}
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
          <span className="text-sm font-medium">{money(montoPerf)}</span>
        </div>
        <div className="mt-3 text-xs text-slate-600">
          Pozos por profundidad
          <GrillaTramos filas={perfFilas} setFilas={(x) => { setPerfFilas(x); setOk(false); }} disabled={dis} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo label="Inicio" type="date" value={f.perf_inicio} onChange={set("perf_inicio")} disabled={dis} />
          <Campo label="Fin" type="date" value={f.perf_fin} onChange={set("perf_fin")} disabled={dis} />
          <Campo label="Burden (m)" value={f.burden_m} onChange={set("burden_m")} disabled={dis} />
          <Campo label="Espaciamiento (m)" value={f.espaciamiento_m} onChange={set("espaciamiento_m")} disabled={dis} />
          <Campo label="Precio USD/m" value={f.perf_precio_usd_m} onChange={set("perf_precio_usd_m")} disabled={dis} />
          <Campo label="TC USD ($/USD)" value={f.perf_tc_usd} onChange={set("perf_tc_usd")} disabled={dis} />
          <Campo label="Noches de sereno" value={f.perf_noches_sereno} onChange={set("perf_noches_sereno")} disabled={dis} />
          <Campo label="Monto por noche ($)" value={f.perf_monto_noche} onChange={set("perf_monto_noche")} disabled={dis} />
        </div>
        {puedeFacturar && (
          <ConciliacionOdoo
            titulo="Perforación"
            endpoint={`/api/cantera/voladuras/${voladura.codigo}/conciliacion`}
            etapa="perf"
            montoCalculado={montoPerf}
            vinculado={{
              moveId: voladura.perf_odoo_move_id,
              moveName: voladura.perf_odoo_move_name,
              empresa: voladura.perf_odoo_empresa,
              ref: voladura.perf_odoo_ref,
              importe: voladura.perf_odoo_importe,
              conforme: voladura.perf_conforme,
              conformeObs: voladura.perf_conforme_obs,
            }}
            onCambio={() => router.refresh()}
          />
        )}
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
        <div className="mt-3 text-xs text-slate-600">
          Pozos volados por profundidad <span className="text-slate-400">(vacío = igual que la perforación)</span>
          <GrillaTramos filas={volFilas} setFilas={(x) => { setVolFilas(x); setOk(false); }} disabled={dis} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo label="Fecha carga explosivo" type="date" value={f.vol_fecha_carga} onChange={set("vol_fecha_carga")} disabled={dis} />
          <Campo label="Fecha de voladura" type="date" value={f.vol_fecha} onChange={set("vol_fecha")} disabled={dis} />
          <Campo label="Burden real (m)" value={f.vol_burden_m} onChange={set("vol_burden_m")} disabled={dis} />
          <Campo label="Espaciam. real (m)" value={f.vol_espaciamiento_m} onChange={set("vol_espaciamiento_m")} disabled={dis} />
          <Campo label="TC USD ($/USD)" value={f.vol_tc_usd} onChange={set("vol_tc_usd")} disabled={dis} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-xs text-slate-600">
            Piedra <span className="text-slate-400">(si difiere del yacimiento)</span>
            <input className={INPUT_CLS} disabled={dis} value={f.material}
              onChange={(e) => set("material")(e.target.value)}
              placeholder={yacimiento?.material ?? "Chocolata / Caliza"} />
          </label>
          <label className="text-xs text-slate-600">
            Densidad (t/m³)
            <input className={INPUT_CLS} disabled={dis} value={f.densidad_t_m3}
              onChange={(e) => set("densidad_t_m3")(e.target.value)}
              placeholder={yacimiento ? String(yacimiento.densidad_t_m3) : "2.7"} />
          </label>
        </div>
        {puedeFacturar && (
          <ConciliacionOdoo
            titulo="Voladura"
            endpoint={`/api/cantera/voladuras/${voladura.codigo}/conciliacion`}
            etapa="vol"
            montoCalculado={montoVol}
            vinculado={{
              moveId: voladura.vol_odoo_move_id,
              moveName: voladura.vol_odoo_move_name,
              empresa: voladura.vol_odoo_empresa,
              ref: voladura.vol_odoo_ref,
              importe: voladura.vol_odoo_importe,
              conforme: voladura.vol_conforme,
              conformeObs: voladura.vol_conforme_obs,
            }}
            onCambio={() => router.refresh()}
          />
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
                {insumos
                  .filter((ins) => ins.tipo !== "voladura")
                  .map((ins) => (
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

        <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-sm">
          <span className="text-slate-500">
            Servicio de voladura (4% de {ars.format(baseUsd)} USD, se calcula solo)
          </span>
          <span>{baseUsd > 0 ? `${num1.format(servicioUsd)} USD` : "—"}</span>
        </div>
        <div className="flex justify-between text-sm font-medium">
          <span>Total voladura</span>
          <span>{money(montoVol)}</span>
        </div>
      </section>

      <section className="mt-4">
        <label className="block text-xs text-slate-600">
          Observaciones
          <textarea className={INPUT_CLS} rows={2} disabled={dis} value={f.observaciones}
            onChange={(e) => set("observaciones")(e.target.value)} />
        </label>
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
