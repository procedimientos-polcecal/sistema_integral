"use client";

import { useRouter } from "next/navigation";
import type { InformeMensual } from "@/lib/cantera/informe";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const money = (v: number | null) => (v == null ? "—" : `$ ${ars.format(v)}`);
const usd = (v: number | null) => (v == null ? "—" : `US$ ${num1.format(v)}`);

function mesLegible(mes: string): string {
  const [anio, mm] = mes.split("-").map(Number);
  const nombres = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return `${nombres[mm - 1]} ${anio}`;
}

export default function InformeClient({ informe, mes }: { informe: InformeMensual; mes: string }) {
  const router = useRouter();

  function cambiarMes(delta: number) {
    const [anio, mm] = mes.split("-").map(Number);
    const d = new Date(anio, mm - 1 + delta, 1);
    const nuevo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    router.push(`/cantera/informes?mes=${nuevo}`);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Informe mensual — {mesLegible(mes)}</h1>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => cambiarMes(-1)} className="rounded border border-slate-300 px-2 py-1">← anterior</button>
          <input
            type="month"
            className="rounded border border-slate-300 px-2 py-1"
            value={mes}
            onChange={(e) => e.target.value && router.push(`/cantera/informes?mes=${e.target.value}`)}
          />
          <button onClick={() => cambiarMes(1)} className="rounded border border-slate-300 px-2 py-1">siguiente →</button>
        </div>
      </div>

      {/* ── Resumen por cantera ── */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">Resumen por cantera</h2>
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
                  <td className="px-3 py-2">{c.usdPorTon == null ? "—" : num2.format(c.usdPorTon)}</td>
                  <td className="px-3 py-2">{c.tonPorMetroPerforado == null ? "—" : num2.format(c.tonPorMetroPerforado)}</td>
                </tr>
              ))}
              {informe.porCantera.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Sin actividad este mes.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Perforaciones del mes ── */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">
          Perforaciones del mes <span className="font-normal text-slate-400">(por fin de perforación)</span>
        </h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Cantera</th>
                <th className="px-3 py-2">Fin</th>
                <th className="px-3 py-2">Metros</th>
                <th className="px-3 py-2">Total USD</th>
                <th className="px-3 py-2">Total ARS</th>
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
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin perforaciones este mes.</td></tr>
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

      {/* ── Voladuras del mes ── */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">
          Voladuras del mes <span className="font-normal text-slate-400">(por fecha de voladura)</span>
        </h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Cantera</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Toneladas</th>
                <th className="px-3 py-2">Total USD</th>
                <th className="px-3 py-2">Total ARS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {informe.voladuras.map((v) => (
                <tr key={v.codigo}>
                  <td className="px-3 py-2 font-mono">{v.codigo}</td>
                  <td className="px-3 py-2 font-mono text-slate-500">{v.cantera}</td>
                  <td className="px-3 py-2">{v.fecha}</td>
                  <td className="px-3 py-2">{v.toneladas == null ? "—" : num1.format(v.toneladas)}</td>
                  <td className="px-3 py-2">{usd(v.montoUsd)}</td>
                  <td className="px-3 py-2">{money(v.montoArs)}</td>
                </tr>
              ))}
              {informe.voladuras.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin voladuras este mes.</td></tr>
              )}
            </tbody>
            {informe.voladuras.length > 0 && (
              <tfoot className="border-t border-slate-200 font-medium">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>Totales</td>
                  <td className="px-3 py-2">{num1.format(informe.totales.toneladas)}</td>
                  <td className="px-3 py-2">{usd(informe.totales.voladuraUsd)}</td>
                  <td className="px-3 py-2">{money(informe.totales.voladuraArs)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* ── Bochones del mes ── */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">
          Bochones del mes <span className="font-normal text-slate-400">(por fecha de voladura)</span>
        </h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Cantera</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Metros</th>
                <th className="px-3 py-2">Total USD</th>
                <th className="px-3 py-2">Total ARS</th>
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
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin bochones este mes.</td></tr>
              )}
            </tbody>
            {informe.bochones.length > 0 && (
              <tfoot className="border-t border-slate-200 font-medium">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>Totales</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2">{usd(informe.totales.bochonUsd)}</td>
                  <td className="px-3 py-2">{money(informe.totales.bochonArs)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <p className="mt-6 text-xs text-slate-400">
        No incluye gramos de explosivo por tonelada: esa cuenta necesita el detalle en gramos por
        pozo, que hoy no es un dato cargado. Se puede sumar cuando se confirme de dónde sale.
      </p>
    </div>
  );
}
