"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { FilaSerieMensual, Informe } from "@/lib/cantera/informe";

const esqueleto = () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />;
const TendenciaToneladas = dynamic(() => import("./GraficosCantera").then((m) => m.TendenciaToneladas), { ssr: false, loading: esqueleto });
const TendenciaUsdPorTon = dynamic(() => import("./GraficosCantera").then((m) => m.TendenciaUsdPorTon), { ssr: false, loading: esqueleto });
const TendenciaGrExplosivoPorTon = dynamic(() => import("./GraficosCantera").then((m) => m.TendenciaGrExplosivoPorTon), { ssr: false, loading: esqueleto });
const TendenciaCostoUsd = dynamic(() => import("./GraficosCantera").then((m) => m.TendenciaCostoUsd), { ssr: false, loading: esqueleto });

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const money = (v: number | null) => (v == null ? "—" : `$ ${ars.format(v)}`);
const usd = (v: number | null) => (v == null ? "—" : `US$ ${num1.format(v)}`);

function Grafico({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h3 className="text-xs font-semibold text-slate-600">{titulo}</h3>
      <div className="mt-2 h-56">{children}</div>
    </div>
  );
}

export default function InformeClient({
  serie,
  informe,
  desde,
  hasta,
}: {
  serie: FilaSerieMensual[];
  informe: Informe | null;
  desde: string;
  hasta: string;
}) {
  const router = useRouter();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);

  function generar() {
    if (!d || !h) return;
    router.push(`/cantera/informes?desde=${d}&hasta=${h}`);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold">Informe de cantera</h1>

      {/* ── Histórico: cómo viene variando ── */}
      <section className="mt-4">
        <h2 className="text-sm font-semibold text-slate-700">Variación mes a mes</h2>
        {serie.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Todavía no hay datos suficientes para un histórico.</p>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Grafico titulo="Toneladas voladas por mes"><TendenciaToneladas datos={serie} /></Grafico>
            <Grafico titulo="USD por tonelada"><TendenciaUsdPorTon datos={serie} /></Grafico>
            <Grafico titulo="Gramos de detonador por tonelada"><TendenciaGrExplosivoPorTon datos={serie} /></Grafico>
            <Grafico titulo="Costo en USD (perforación + voladura)"><TendenciaCostoUsd datos={serie} /></Grafico>
          </div>
        )}
      </section>

      {/* ── Generar informe de un período ── */}
      <section className="mt-8 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-700">Generar informe por fecha</h2>
        <p className="mt-1 text-xs text-slate-500">
          Arma las tablas del período —como las que hoy armás en el Sheets— para exportarlas y escribir el informe.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Desde
            <input type="date" className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm" value={d} onChange={(e) => setD(e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Hasta
            <input type="date" className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm" value={h} onChange={(e) => setH(e.target.value)} />
          </label>
          <button
            disabled={!d || !h}
            onClick={generar}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Generar informe
          </button>
          {informe && (
            <a
              href={`/api/cantera/informes/export?desde=${informe.desde}&hasta=${informe.hasta}`}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            >
              Exportar a Excel
            </a>
          )}
        </div>
      </section>

      {informe && (
        <>
          {/* ── Resumen por cantera ── */}
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">
              Resumen por cantera — {informe.desde} a {informe.hasta}
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Cantera</th>
                    <th className="px-3 py-2">Toneladas</th>
                    <th className="px-3 py-2">Perf. USD</th>
                    <th className="px-3 py-2">Detonador USD</th>
                    <th className="px-3 py-2">Otros insumos USD</th>
                    <th className="px-3 py-2">Servicio USD</th>
                    <th className="px-3 py-2">Gr expl./ton</th>
                    <th className="px-3 py-2">USD/Ton</th>
                    <th className="px-3 py-2">Ton/m perf.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {informe.porCantera.map((c) => (
                    <tr key={c.cantera}>
                      <td className="px-3 py-2 font-mono">{c.cantera}</td>
                      <td className="px-3 py-2">{num1.format(c.toneladas)}</td>
                      <td className="px-3 py-2">{usd(c.perforacionUsd)}</td>
                      <td className="px-3 py-2">{usd(c.detonadorUsd)}</td>
                      <td className="px-3 py-2">{usd(c.otrosInsumosUsd)}</td>
                      <td className="px-3 py-2">{usd(c.servicioUsd)}</td>
                      <td className="px-3 py-2">{c.grExplosivoPorTon == null ? "—" : num2.format(c.grExplosivoPorTon)}</td>
                      <td className="px-3 py-2">{c.usdPorTon == null ? "—" : num2.format(c.usdPorTon)}</td>
                      <td className="px-3 py-2">{c.tonPorMetroPerforado == null ? "—" : num2.format(c.tonPorMetroPerforado)}</td>
                    </tr>
                  ))}
                  {informe.porCantera.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Sin actividad en el período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Perforaciones ── */}
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">
              Perforaciones <span className="font-normal text-slate-400">(por fin de perforación)</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Código</th><th className="px-3 py-2">Cantera</th>
                    <th className="px-3 py-2">Fin</th><th className="px-3 py-2">Metros</th>
                    <th className="px-3 py-2">Total USD</th><th className="px-3 py-2">Total ARS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {informe.perforaciones.map((p) => (
                    <tr key={p.codigo}>
                      <td className="px-3 py-2 font-mono">{p.codigo}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{p.cantera}</td>
                      <td className="px-3 py-2">{p.fin}</td>
                      <td className="px-3 py-2">{p.metros == null ? "—" : num1.format(p.metros)}</td>
                      <td className="px-3 py-2">{usd(p.montoUsd)}</td>
                      <td className="px-3 py-2">{money(p.montoArs)}</td>
                    </tr>
                  ))}
                  {informe.perforaciones.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin perforaciones en el período.</td></tr>
                  )}
                </tbody>
                {informe.perforaciones.length > 0 && (
                  <tfoot className="border-t border-slate-200 font-medium">
                    <tr>
                      <td className="px-3 py-2" colSpan={3}>Totales</td>
                      <td className="px-3 py-2">{num1.format(informe.totales.metrosPerforados)}</td>
                      <td className="px-3 py-2">{usd(informe.totales.perforacionUsd)}</td>
                      <td className="px-3 py-2">{money(informe.totales.perforacionArs)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* ── Voladuras ── */}
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">
              Voladuras <span className="font-normal text-slate-400">(por fecha de voladura)</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Código</th><th className="px-3 py-2">Cantera</th>
                    <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Gr detonador</th>
                    <th className="px-3 py-2">Toneladas</th>
                    <th className="px-3 py-2">Total USD</th><th className="px-3 py-2">Total ARS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {informe.voladuras.map((v) => (
                    <tr key={v.codigo}>
                      <td className="px-3 py-2 font-mono">{v.codigo}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{v.cantera}</td>
                      <td className="px-3 py-2">{v.fecha}</td>
                      <td className="px-3 py-2">{num1.format(v.gramosDetonador)}</td>
                      <td className="px-3 py-2">{v.toneladas == null ? "—" : num1.format(v.toneladas)}</td>
                      <td className="px-3 py-2">{usd(v.montoUsd)}</td>
                      <td className="px-3 py-2">{money(v.montoArs)}</td>
                    </tr>
                  ))}
                  {informe.voladuras.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Sin voladuras en el período.</td></tr>
                  )}
                </tbody>
                {informe.voladuras.length > 0 && (
                  <tfoot className="border-t border-slate-200 font-medium">
                    <tr>
                      <td className="px-3 py-2" colSpan={3}>Totales</td>
                      <td className="px-3 py-2">{num1.format(informe.totales.gramosDetonador)}</td>
                      <td className="px-3 py-2">{num1.format(informe.totales.toneladas)}</td>
                      <td className="px-3 py-2">{usd(informe.totales.voladuraUsd)}</td>
                      <td className="px-3 py-2">{money(informe.totales.voladuraArs)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* ── Bochones ── */}
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">
              Bochones <span className="font-normal text-slate-400">(por fecha de voladura)</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Código</th><th className="px-3 py-2">Cantera</th>
                    <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Metros</th>
                    <th className="px-3 py-2">Total USD</th><th className="px-3 py-2">Total ARS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {informe.bochones.map((b) => (
                    <tr key={b.codigo}>
                      <td className="px-3 py-2 font-mono">{b.codigo}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{b.cantera}</td>
                      <td className="px-3 py-2">{b.fecha}</td>
                      <td className="px-3 py-2">{b.metros == null ? "—" : num1.format(b.metros)}</td>
                      <td className="px-3 py-2">{usd(b.montoUsd)}</td>
                      <td className="px-3 py-2">{money(b.montoArs)}</td>
                    </tr>
                  ))}
                  {informe.bochones.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin bochones en el período.</td></tr>
                  )}
                </tbody>
                {informe.bochones.length > 0 && (
                  <tfoot className="border-t border-slate-200 font-medium">
                    <tr>
                      <td className="px-3 py-2" colSpan={4}>Totales</td>
                      <td className="px-3 py-2">{usd(informe.totales.bochonUsd)}</td>
                      <td className="px-3 py-2">{money(informe.totales.bochonArs)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
