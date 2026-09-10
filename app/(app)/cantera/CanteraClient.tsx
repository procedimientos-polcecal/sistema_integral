"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { LecturaDeCruce } from "@/lib/cantera/costos";
import type { Yacimiento } from "@/lib/cantera/types";

export interface FilaVoladura {
  codigo: string;
  vol_fecha: string | null;
  perf_fin: string | null;
  pozos: number | null;
  montoPerf: number | null;
  montoVol: number | null;
  toneladas: number | null;
  toneladas_planilla: number | null;
  desvioFuera: boolean;
  crucePerf: LecturaDeCruce;
  cruceVol: LecturaDeCruce;
  sheets_pendiente: string | null;
}

export interface FilaBochon {
  codigo: string;
  fin: string | null;
  voladura_codigo: string | null;
  metros_perforados: number | null;
  monto: number | null;
  cruce: LecturaDeCruce;
  sheets_pendiente: string | null;
}

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const money = (v: number | null) => (v === null ? "—" : `$ ${ars.format(v)}`);

function ChipCruce({ lectura }: { lectura: LecturaDeCruce }) {
  const estilo: Record<LecturaDeCruce, string> = {
    coincide: "bg-emerald-50 text-emerald-700",
    revisar: "bg-red-50 text-red-700",
    sin_factura: "bg-amber-50 text-amber-700",
    sin_monto: "bg-slate-100 text-slate-500",
  };
  const texto: Record<LecturaDeCruce, string> = {
    coincide: "coincide",
    revisar: "revisar",
    sin_factura: "sin factura",
    sin_monto: "sin monto",
  };
  return <span className={`rounded px-1.5 py-0.5 text-xs ${estilo[lectura]}`}>{texto[lectura]}</span>;
}

export default function CanteraClient({
  yacimientos,
  elegido,
  voladuras,
  bochones,
  puedeEditar,
  puedeFacturar,
}: {
  yacimientos: Yacimiento[];
  elegido: Yacimiento | null;
  voladuras: FilaVoladura[];
  bochones: FilaBochon[];
  puedeEditar: boolean;
  puedeFacturar: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();

  if (yacimientos.length === 0) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-xl font-semibold">Cantera</h1>
        <p className="mt-3 text-sm text-slate-500">
          Todavía no hay canteras cargadas. Un admin las carga en{" "}
          <Link href="/cantera/yacimientos" className="text-slate-800 underline">Canteras</Link>.
        </p>
      </div>
    );
  }

  const avisos: string[] = [];
  const sinConciliar = [...voladuras, ...bochones].filter((f) =>
    "montoPerf" in f
      ? f.crucePerf === "sin_factura" || f.cruceVol === "sin_factura" || f.crucePerf === "revisar" || f.cruceVol === "revisar"
      : f.cruce === "sin_factura" || f.cruce === "revisar"
  ).length;
  if (sinConciliar > 0) avisos.push(`${sinConciliar} registro(s) con factura sin conciliar o a revisar.`);
  const desvios = voladuras.filter((v) => v.desvioFuera).length;
  if (desvios > 0) avisos.push(`${desvios} voladura(s) con toneladas fuera del ±15% de la planilla histórica.`);
  const pendientes = [...voladuras, ...bochones].filter((f) => f.sheets_pendiente).length;
  if (pendientes > 0) avisos.push(`${pendientes} fila(s) que no llegaron a la planilla.`);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Cantera</h1>
        {puedeEditar && (
          <Link
            href={`/cantera/voladuras/nueva${elegido ? `?y=${elegido.id}` : ""}`}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
          >
            Cargar voladura
          </Link>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {yacimientos.map((y) => (
          <button
            key={y.id}
            onClick={() => {
              const p = new URLSearchParams(search);
              p.set("y", y.id);
              router.push(`/cantera?${p.toString()}`);
            }}
            className={`rounded-full border px-3 py-1 text-sm ${
              elegido?.id === y.id ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300"
            }`}
          >
            {y.nombre} <span className="opacity-60">· {y.material}</span>
          </button>
        ))}
      </div>

      {avisos.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {avisos.map((a) => <li key={a}>• {a}</li>)}
        </ul>
      )}

      {elegido && (
        <>
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">
              Perforaciones y voladuras — {elegido.nombre}
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Voladura</th>
                    <th className="px-3 py-2">Pozos</th>
                    <th className="px-3 py-2">Monto perf.</th>
                    <th className="px-3 py-2">Monto vol.</th>
                    <th className="px-3 py-2">Toneladas</th>
                    <th className="px-3 py-2">Facturas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {voladuras.map((v) => (
                    <tr key={v.codigo} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono">
                        <Link href={`/cantera/voladuras/${v.codigo}`} className="text-slate-800 underline">
                          {v.codigo}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{v.vol_fecha ?? <span className="text-slate-400">sin volar</span>}</td>
                      <td className="px-3 py-2">{v.pozos ?? "—"}</td>
                      <td className="px-3 py-2">{money(v.montoPerf)}</td>
                      <td className="px-3 py-2">{money(v.montoVol)}</td>
                      <td className={`px-3 py-2 ${v.desvioFuera ? "text-amber-700" : ""}`}>
                        {v.toneladas === null ? "—" : num.format(v.toneladas)}
                        {v.toneladas_planilla != null && (
                          <span className="ml-1 text-xs text-slate-400">(pl. {num.format(v.toneladas_planilla)})</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="mr-1">P:</span><ChipCruce lectura={v.crucePerf} />
                        <span className="ml-2 mr-1">V:</span><ChipCruce lectura={v.cruceVol} />
                      </td>
                    </tr>
                  ))}
                  {voladuras.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                      Sin voladuras en esta cantera.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">Bochones — {elegido.nombre}</h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Fin</th>
                    <th className="px-3 py-2">Voladura</th>
                    <th className="px-3 py-2">Metros perf.</th>
                    <th className="px-3 py-2">Monto</th>
                    <th className="px-3 py-2">Factura</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bochones.map((b) => (
                    <tr key={b.codigo} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono">{b.codigo}</td>
                      <td className="px-3 py-2">{b.fin ?? "—"}</td>
                      <td className="px-3 py-2">{b.voladura_codigo ?? "—"}</td>
                      <td className="px-3 py-2">{b.metros_perforados ?? "—"}</td>
                      <td className="px-3 py-2">{money(b.monto)}</td>
                      <td className="px-3 py-2"><ChipCruce lectura={b.cruce} /></td>
                    </tr>
                  ))}
                  {bochones.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin bochones en esta cantera.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {puedeFacturar && !puedeEditar && (
        <p className="mt-6 text-xs text-slate-400">
          Estás en la lista de finanzas: abrí una voladura para vincular su factura de Odoo.
        </p>
      )}
    </div>
  );
}
