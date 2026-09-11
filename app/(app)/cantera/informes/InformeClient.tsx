"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { FilaSerieMensual, Informe } from "@/lib/cantera/informe";

const esqueleto = () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />;
const TendenciaToneladas = dynamic(() => import("./GraficosCantera").then((m) => m.TendenciaToneladas), { ssr: false, loading: esqueleto });
const TendenciaUsdPorTon = dynamic(() => import("./GraficosCantera").then((m) => m.TendenciaUsdPorTon), { ssr: false, loading: esqueleto });
const TendenciaGrExplosivoPorTon = dynamic(() => import("./GraficosCantera").then((m) => m.TendenciaGrExplosivoPorTon), { ssr: false, loading: esqueleto });
const TendenciaCostoUsd = dynamic(() => import("./GraficosCantera").then((m) => m.TendenciaCostoUsd), { ssr: false, loading: esqueleto });
const TortaCostoPorCantera = dynamic(() => import("./GraficosCantera").then((m) => m.TortaCostoPorCantera), { ssr: false, loading: esqueleto });
const BarraUsdPorTonPorCantera = dynamic(() => import("./GraficosCantera").then((m) => m.BarraUsdPorTonPorCantera), { ssr: false, loading: esqueleto });

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const money = (v: number | null) => (v == null ? "—" : `$ ${ars.format(v)}`);
const usd = (v: number | null) => (v == null ? "—" : `US$ ${num1.format(v)}`);

// Los mismos dos colores que usa la planilla para las secciones del informe:
// verde para perforaciones/bochones/totales, ámbar para voladuras/consumos.
const VERDE = "#1E7D34";
const VERDE_CLARO = "#F0F8F5";
const AMBAR = "#E8A020";
const AMBAR_CLARO = "#FFF7ED";

function Grafico({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h3 className="text-xs font-semibold text-slate-600">{titulo}</h3>
      <div className="mt-2 h-56">{children}</div>
    </div>
  );
}

/** El encabezado de una sección/tabla, con el color verde o ámbar de la planilla. */
function Encabezado({ color, columnas }: { color: string; columnas: string[] }) {
  return (
    <tr style={{ backgroundColor: color }}>
      {columnas.map((c) => (
        <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-white">{c}</th>
      ))}
    </tr>
  );
}

/** Una fila de datos con cebra del color de su sección. */
function FilaCebra({
  i,
  claro,
  children,
}: {
  i: number;
  claro: string;
  children: React.ReactNode;
}) {
  return <tr style={{ backgroundColor: i % 2 === 1 ? claro : undefined }}>{children}</tr>;
}

function FilaTotal({ children }: { children: React.ReactNode }) {
  return (
    <tr style={{ backgroundColor: VERDE }} className="font-semibold text-white">
      {children}
    </tr>
  );
}

export default function InformeClient({
  serieTodas,
  seriePorCantera,
  canteras,
  informe,
  desde,
  hasta,
}: {
  serieTodas: FilaSerieMensual[];
  seriePorCantera: Record<string, FilaSerieMensual[]>;
  canteras: string[];
  informe: Informe | null;
  desde: string;
  hasta: string;
}) {
  const router = useRouter();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);
  const [canteraGrafico, setCanteraGrafico] = useState("");

  function generar() {
    if (!d || !h) return;
    router.push(`/cantera/informes?desde=${d}&hasta=${h}`);
  }

  const serie = canteraGrafico ? (seriePorCantera[canteraGrafico] ?? []) : serieTodas;

  // Consumos agrupados por tipo, con subtotal — igual que la planilla: todos
  // los renglones de "Detonador" seguidos, después "Otros insumos", después
  // "Voladura" (el servicio), cada grupo con su fila de subtotal.
  const gruposConsumo = informe
    ? (["detonador", "otros_insumos", "voladura"] as const)
        .map((tipo) => ({ tipo, filas: informe.consumosDetalle.filter((c) => c.tipo === tipo) }))
        .filter((g) => g.filas.length > 0)
    : [];
  const ETIQUETA_TIPO: Record<string, string> = { detonador: "Detonador", otros_insumos: "Otros insumos", voladura: "Voladura" };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold">Informe de cantera</h1>

      {/* ── Histórico: cómo viene variando ── */}
      <section className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Variación mes a mes</h2>
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={canteraGrafico}
            onChange={(e) => setCanteraGrafico(e.target.value)}
          >
            <option value="">Todas las canteras</option>
            {canteras.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
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
          Arma las tablas del período —las mismas que hoy armás en el Sheets— para exportarlas y escribir el informe.
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
        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
          {/* ── Título, como el de la planilla ── */}
          <div style={{ backgroundColor: VERDE }} className="px-4 py-2 text-sm font-semibold text-white">
            INFORME DE CANTERAS — {informe.desde} a {informe.hasta}
          </div>
          <div style={{ backgroundColor: VERDE_CLARO }} className="px-4 py-1.5 text-xs text-slate-500">
            Generado: {new Date().toLocaleString("es-AR")} · Filtro: fin de perforación / fecha de voladura / fecha de voladura del bochón
          </div>

          <div className="p-4">
            {/* ── Los dos gráficos por cantera del período ── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Grafico titulo="Costo Total USD por Cantera"><TortaCostoPorCantera datos={informe.porCantera} /></Grafico>
              <Grafico titulo="Costo USD/Ton por Cantera"><BarraUsdPorTonPorCantera datos={informe.porCantera} /></Grafico>
            </div>

            {/* ── Resumen por cantera (junta los seis paneles chicos de la planilla) ── */}
            <h2 className="mt-6 text-sm font-semibold text-slate-700">Resumen por cantera</h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead><Encabezado color={VERDE} columnas={["Cantera", "Toneladas", "Costo total USD", "Perf. USD", "Explosivo USD", "Accesorios USD", "Servicio USD", "Gr Expl./Ton", "USD/Ton", "Ton/m Perf."]} /></thead>
                <tbody>
                  {informe.porCantera.map((c, i) => (
                    <FilaCebra key={c.cantera} i={i} claro={VERDE_CLARO}>
                      <td className="px-3 py-2 font-mono">{c.cantera}</td>
                      <td className="px-3 py-2">{num1.format(c.toneladas)}</td>
                      <td className="px-3 py-2">{usd(c.costoTotalUsd)}</td>
                      <td className="px-3 py-2">{usd(c.perforacionUsd)}</td>
                      <td className="px-3 py-2">{usd(c.detonadorUsd)}</td>
                      <td className="px-3 py-2">{usd(c.otrosInsumosUsd)}</td>
                      <td className="px-3 py-2">{usd(c.servicioUsd)}</td>
                      <td className="px-3 py-2">{c.grExplosivoPorTon == null ? "—" : num2.format(c.grExplosivoPorTon)}</td>
                      <td className="px-3 py-2">{c.usdPorTon == null ? "—" : num2.format(c.usdPorTon)}</td>
                      <td className="px-3 py-2">{c.tonPorMetroPerforado == null ? "—" : num2.format(c.tonPorMetroPerforado)}</td>
                    </FilaCebra>
                  ))}
                  {informe.porCantera.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Sin actividad en el período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Perforaciones del período ── */}
            <h2 className="mt-6 text-sm font-semibold text-slate-700">
              ▸ Perforaciones <span className="font-normal text-slate-400">(por fin de perforación)</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead><Encabezado color={VERDE} columnas={["Código", "Cantera", "Fin Perf.", "Prof. (mts)", "Pozos", "Metros Perf.", "Total USD", "Total ARS"]} /></thead>
                <tbody>
                  {informe.perforaciones.map((p, i) => (
                    <FilaCebra key={p.codigo} i={i} claro={VERDE_CLARO}>
                      <td className="px-3 py-2 font-mono">{p.codigo}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{p.cantera}</td>
                      <td className="px-3 py-2">{p.fin}</td>
                      <td className="px-3 py-2">{p.profundidadProm == null ? "—" : num2.format(p.profundidadProm)}</td>
                      <td className="px-3 py-2">{p.pozos ?? "—"}</td>
                      <td className="px-3 py-2">{p.metros == null ? "—" : num1.format(p.metros)}</td>
                      <td className="px-3 py-2">{usd(p.montoUsd)}</td>
                      <td className="px-3 py-2">{money(p.montoArs)}</td>
                    </FilaCebra>
                  ))}
                  {informe.perforaciones.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Sin perforaciones en el período.</td></tr>
                  )}
                </tbody>
                {informe.perforaciones.length > 0 && (
                  <tfoot>
                    <FilaTotal>
                      <td className="px-3 py-2" colSpan={4}>TOTALES</td>
                      <td className="px-3 py-2">{informe.perforaciones.reduce((s, p) => s + (p.pozos ?? 0), 0)}</td>
                      <td className="px-3 py-2">{num1.format(informe.totales.metrosPerforados)}</td>
                      <td className="px-3 py-2">{usd(informe.totales.perforacionUsd)}</td>
                      <td className="px-3 py-2">{money(informe.totales.perforacionArs)}</td>
                    </FilaTotal>
                  </tfoot>
                )}
              </table>
            </div>

            {/* ── Voladuras del período ── */}
            <h2 className="mt-6 text-sm font-semibold text-slate-700">
              ▸ Voladuras <span className="font-normal text-slate-400">(por fecha de voladura)</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead><Encabezado color={AMBAR} columnas={["Código", "Cantera", "Fecha Voladura", "Gr Detonador", "Toneladas", "Total USD", "Total ARS"]} /></thead>
                <tbody>
                  {informe.voladuras.map((v, i) => (
                    <FilaCebra key={v.codigo} i={i} claro={AMBAR_CLARO}>
                      <td className="px-3 py-2 font-mono">{v.codigo}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{v.cantera}</td>
                      <td className="px-3 py-2">{v.fecha}</td>
                      <td className="px-3 py-2">{num1.format(v.gramosDetonador)}</td>
                      <td className="px-3 py-2">{v.toneladas == null ? "—" : num1.format(v.toneladas)}</td>
                      <td className="px-3 py-2">{usd(v.montoUsd)}</td>
                      <td className="px-3 py-2">{money(v.montoArs)}</td>
                    </FilaCebra>
                  ))}
                  {informe.voladuras.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Sin voladuras en el período.</td></tr>
                  )}
                </tbody>
                {informe.voladuras.length > 0 && (
                  <tfoot>
                    <FilaTotal>
                      <td className="px-3 py-2" colSpan={3}>TOTALES</td>
                      <td className="px-3 py-2">{num1.format(informe.totales.gramosDetonador)}</td>
                      <td className="px-3 py-2">{num1.format(informe.totales.toneladas)}</td>
                      <td className="px-3 py-2">{usd(informe.totales.voladuraUsd)}</td>
                      <td className="px-3 py-2">{money(informe.totales.voladuraArs)}</td>
                    </FilaTotal>
                  </tfoot>
                )}
              </table>
            </div>

            {/* ── Bochones del período ── */}
            <h2 className="mt-6 text-sm font-semibold text-slate-700">
              ▸ Bochones <span className="font-normal text-slate-400">(por fecha de voladura)</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead><Encabezado color={VERDE} columnas={["Código", "Cantera", "Fecha Voladura", "Metros Perf.", "Total USD", "Total ARS"]} /></thead>
                <tbody>
                  {informe.bochones.map((b, i) => (
                    <FilaCebra key={b.codigo} i={i} claro={VERDE_CLARO}>
                      <td className="px-3 py-2 font-mono">{b.codigo}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{b.cantera}</td>
                      <td className="px-3 py-2">{b.fecha}</td>
                      <td className="px-3 py-2">{b.metros == null ? "—" : num1.format(b.metros)}</td>
                      <td className="px-3 py-2">{usd(b.montoUsd)}</td>
                      <td className="px-3 py-2">{money(b.montoArs)}</td>
                    </FilaCebra>
                  ))}
                  {informe.bochones.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin bochones en el período.</td></tr>
                  )}
                </tbody>
                {informe.bochones.length > 0 && (
                  <tfoot>
                    <FilaTotal>
                      <td className="px-3 py-2" colSpan={3}>TOTALES</td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2">{usd(informe.totales.bochonUsd)}</td>
                      <td className="px-3 py-2">{money(informe.totales.bochonArs)}</td>
                    </FilaTotal>
                  </tfoot>
                )}
              </table>
            </div>

            {/* ── Consumos del período, con subtotal por tipo ── */}
            <h2 className="mt-6 text-sm font-semibold text-slate-700">▸ Consumos (detalle)</h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead><Encabezado color={AMBAR} columnas={["Código", "Tipo", "Insumo", "Cantidad", "Precio USD", "Total USD", "Total ARS"]} /></thead>
                <tbody>
                  {gruposConsumo.map((g) => (
                    <Fragment key={g.tipo}>
                      {g.filas.map((c, i) => (
                        <FilaCebra key={`${c.codigo}-${g.tipo}-${i}`} i={i} claro={AMBAR_CLARO}>
                          <td className="px-3 py-2 font-mono">{c.codigo}</td>
                          <td className="px-3 py-2">{ETIQUETA_TIPO[c.tipo] ?? c.tipo}</td>
                          <td className="px-3 py-2">{c.insumo}</td>
                          <td className="px-3 py-2">{num2.format(c.cantidad)}</td>
                          <td className="px-3 py-2">{c.precioUsd == null ? "—" : usd(c.precioUsd)}</td>
                          <td className="px-3 py-2">{usd(c.totalUsd)}</td>
                          <td className="px-3 py-2">{money(c.totalArs)}</td>
                        </FilaCebra>
                      ))}
                      <tr style={{ backgroundColor: AMBAR_CLARO }} className="font-semibold">
                        <td className="px-3 py-2" colSpan={5}>Subtotal {ETIQUETA_TIPO[g.tipo] ?? g.tipo}</td>
                        <td className="px-3 py-2">{usd(g.filas.reduce((s, c) => s + (c.totalUsd ?? 0), 0))}</td>
                        <td className="px-3 py-2">{money(g.filas.reduce((s, c) => s + (c.totalArs ?? 0), 0))}</td>
                      </tr>
                    </Fragment>
                  ))}
                  {gruposConsumo.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Sin consumos en el período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
