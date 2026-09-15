"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { LecturaDeCruce } from "@/lib/cantera/costos";
import type { Yacimiento } from "@/lib/cantera/types";
import { avisosDe, type FilaBochon, type FilaVoladura } from "@/lib/cantera/tablero";

export type { FilaBochon, FilaVoladura };

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const money = (v: number | null) => (v === null ? "—" : `$ ${ars.format(v)}`);

/** Exportado: la página de inicio del módulo lo reusa para su adelanto de registros. */
export function ChipCruce({ lectura }: { lectura: LecturaDeCruce }) {
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
  yacimientoId,
  desde,
  hasta,
  voladuras,
  bochones,
  puedeEditar,
  puedeFacturar,
}: {
  yacimientos: Yacimiento[];
  yacimientoId: string;
  desde: string;
  hasta: string;
  voladuras: FilaVoladura[];
  bochones: FilaBochon[];
  puedeEditar: boolean;
  puedeFacturar: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  // Los avisos se pueden cerrar con la cruz; se recuerdan por su texto y no
  // por índice, para no reabrir el que sigue si cambia la cantidad de filas.
  const [avisosCerrados, setAvisosCerrados] = useState<string[]>([]);

  function irCon(cambios: Record<string, string>) {
    const p = new URLSearchParams(search);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`/cantera/registros?${p.toString()}`);
  }

  if (yacimientos.length === 0) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
        <h1 className="mt-1 text-xl font-semibold">Registros</h1>
        <p className="mt-3 text-sm text-slate-500">
          Todavía no hay canteras cargadas. Un admin las carga en{" "}
          <Link href="/cantera/yacimientos" className="text-slate-800 underline">Canteras</Link>.
        </p>
      </div>
    );
  }

  const avisos = avisosDe(voladuras, bochones);

  const desQ = yacimientoId ? `?y=${yacimientoId}` : "";

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Registros</h1>
        {puedeEditar && (
          <div className="flex gap-2">
            <Link href={`/cantera/voladuras/nueva${desQ}`} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
              Cargar voladura
            </Link>
            <Link href={`/cantera/bochones/nuevo${desQ}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              Cargar bochón
            </Link>
          </div>
        )}
      </div>

      {/* Filtros en una línea: cantera + rango de fecha de voladura. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={yacimientoId}
          onChange={(e) => irCon({ y: e.target.value })}
        >
          <option value="">Todas las canteras</option>
          {yacimientos.map((y) => (
            <option key={y.id} value={y.id}>{y.nombre} · {y.material}</option>
          ))}
        </select>
        <span className="text-slate-400">·</span>
        <input
          type="date"
          className="rounded border border-slate-300 px-2 py-1"
          value={desde}
          onChange={(e) => irCon({ desde: e.target.value })}
        />
        <span className="text-slate-400">a</span>
        <input
          type="date"
          className="rounded border border-slate-300 px-2 py-1"
          value={hasta}
          onChange={(e) => irCon({ hasta: e.target.value })}
        />
        {(desde || hasta) && (
          <button onClick={() => irCon({ desde: "", hasta: "" })} className="text-xs text-slate-500 underline">
            limpiar fechas
          </button>
        )}
      </div>

      {avisos.filter((a) => !avisosCerrados.includes(a)).length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {avisos.filter((a) => !avisosCerrados.includes(a)).map((a) => (
            <li key={a} className="flex items-start justify-between gap-3">
              <span>• {a}</span>
              <button
                onClick={() => setAvisosCerrados((prev) => [...prev, a])}
                aria-label="Cerrar este aviso"
                className="shrink-0 text-amber-600 hover:text-amber-900"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">Perforaciones y voladuras</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Cantera</th>
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
                    <Link href={`/cantera/voladuras/${v.codigo}`} className="text-slate-800 underline">{v.codigo}</Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-500">{v.yacimiento}</td>
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
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="mr-1">P:</span><ChipCruce lectura={v.crucePerf} />
                    <span className="ml-2 mr-1">V:</span><ChipCruce lectura={v.cruceVol} />
                  </td>
                </tr>
              ))}
              {voladuras.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Sin voladuras para este filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">Bochones</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Cantera</th>
                <th className="px-3 py-2">Fecha voladura</th>
                <th className="px-3 py-2">Voladura asoc.</th>
                <th className="px-3 py-2">Cantidad</th>
                <th className="px-3 py-2">Metros perf.</th>
                <th className="px-3 py-2">Monto</th>
                <th className="px-3 py-2">Factura</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bochones.map((b) => (
                <tr key={b.codigo} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono">
                    <Link href={`/cantera/bochones/${b.codigo}`} className="text-slate-800 underline">{b.codigo}</Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-500">{b.yacimiento}</td>
                  <td className="px-3 py-2">{b.fecha ?? "—"}</td>
                  <td className="px-3 py-2">{b.voladura_codigo ?? "—"}</td>
                  <td className="px-3 py-2">{b.cantidad ?? "—"}</td>
                  <td className="px-3 py-2">{b.metros_perforados ?? "—"}</td>
                  <td className="px-3 py-2">{money(b.monto)}</td>
                  <td className="px-3 py-2"><ChipCruce lectura={b.cruce} /></td>
                </tr>
              ))}
              {bochones.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Sin bochones para este filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {puedeFacturar && !puedeEditar && (
        <p className="mt-6 text-xs text-slate-400">
          Estás en la lista de finanzas: abrí una voladura para vincular su factura de Odoo.
        </p>
      )}
    </div>
  );
}
