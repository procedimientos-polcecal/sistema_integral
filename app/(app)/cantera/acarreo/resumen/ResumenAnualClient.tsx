"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Fletero } from "@/lib/cantera/types";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const money = (v: number) => (v > 0 ? `$ ${ars.format(v)}` : "—");

const NOMBRES_MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export default function ResumenAnualClient({
  anio,
  filas,
}: {
  anio: string;
  filas: { fletero: Fletero; porMes: number[]; totalAnual: number }[];
}) {
  const router = useRouter();
  const totalesPorMes = NOMBRES_MES.map((_, i) => filas.reduce((s, f) => s + f.porMes[i], 0));
  const totalAnual = filas.reduce((s, f) => s + f.totalAnual, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/cantera/acarreo" className="text-xs text-slate-500 underline">← Acarreo</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Resumen anual por fletero</h1>
        <select
          className="rounded border border-slate-300 px-2 py-1 text-sm"
          value={anio}
          onChange={(e) => router.push(`/cantera/acarreo/resumen?anio=${e.target.value}`)}
        >
          {[0, 1, 2].map((d) => {
            const a = String(Number(anio) - 1 + d);
            return <option key={a} value={a}>{a}</option>;
          })}
        </select>
      </div>
      <p className="mt-1 text-sm text-slate-500">Cuánto se le pagó a cada fletero cada mes — material + horas + viajes juntos.</p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left uppercase text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">Fletero</th>
              {NOMBRES_MES.map((m) => (
                <th key={m} className="whitespace-nowrap px-2 py-2 text-right">{m}</th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-right">Total anual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.map(({ fletero, porMes, totalAnual }) => (
              <tr key={fletero.id} className={totalAnual > 0 ? "" : "text-slate-300"}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">{fletero.nombre}</td>
                {porMes.map((v, i) => (
                  <td key={i} className="whitespace-nowrap px-2 py-1.5 text-right">{money(v)}</td>
                ))}
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">{money(totalAnual)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="whitespace-nowrap px-3 py-2">Total</td>
              {totalesPorMes.map((v, i) => (
                <td key={i} className="whitespace-nowrap px-2 py-2 text-right">{money(v)}</td>
              ))}
              <td className="whitespace-nowrap px-3 py-2 text-right">{money(totalAnual)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
