"use client";

import { useRouter } from "next/navigation";
import { ETIQUETA_UNIDAD, type FilaResumenAnualTipo, type UnidadDeAcarreo } from "@/lib/cantera/acarreo";
import type { Fletero } from "@/lib/cantera/types";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const money = (v: number) => (v > 0 ? `$ ${ars.format(v)}` : "—");
const cantidad = (v: number, unidad: UnidadDeAcarreo) => (v > 0 ? `${num1.format(v)} ${ETIQUETA_UNIDAD[unidad]}` : "—");

const NOMBRES_MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/**
 * Los dos "RESUMEN ANUAL" de la planilla real (por fletero y de materiales),
 * en la página de inicio de Cantera en vez de una pestaña aparte — el
 * usuario lo pidió así explícitamente después de que existiera como
 * `/cantera/acarreo/resumen`.
 */
export default function ResumenesAnuales({
  anio,
  filasFleteros,
  filasMateriales,
}: {
  anio: string;
  filasFleteros: { fletero: Fletero; porMes: number[]; totalAnual: number }[];
  filasMateriales: FilaResumenAnualTipo[];
}) {
  const router = useRouter();

  return (
    <section className="card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Resumen anual</h2>
        <select
          className="rounded border border-slate-300 px-2 py-1 text-sm"
          value={anio}
          onChange={(e) => router.push(`/cantera?anio=${e.target.value}`)}
        >
          {[0, 1, 2].map((d) => {
            const a = String(Number(anio) - 1 + d);
            return <option key={a} value={a}>{a}</option>;
          })}
        </select>
      </div>

      <p className="mt-4 text-sm font-semibold text-cyan-700">Por fletero</p>
      <TablaAnual
        filas={filasFleteros.map((f) => ({ etiqueta: f.fletero.nombre, porMes: f.porMes, total: f.totalAnual }))}
        formato={money}
        colorCabecera="bg-cyan-600"
        colorTotal="bg-cyan-50 text-cyan-900"
        colorFranja="even:bg-cyan-50/40"
      />

      <p className="mt-6 text-sm font-semibold text-emerald-700">De materiales</p>
      <TablaAnual
        filas={filasMateriales.map((f) => ({ etiqueta: f.etiqueta, porMes: f.porMes, total: f.totalAnual, unidad: f.unidad }))}
        formato={(v, unidad) => cantidad(v, unidad ?? "tonelada")}
        colorCabecera="bg-emerald-600"
        colorTotal="bg-emerald-50 text-emerald-900"
        colorFranja="even:bg-emerald-50/40"
      />
    </section>
  );
}

function TablaAnual({
  filas,
  formato,
  colorCabecera,
  colorTotal,
  colorFranja,
}: {
  filas: { etiqueta: string; porMes: number[]; total: number; unidad?: UnidadDeAcarreo }[];
  formato: (v: number, unidad?: UnidadDeAcarreo) => string;
  colorCabecera: string;
  colorTotal: string;
  colorFranja: string;
}) {
  if (filas.length === 0) {
    return <p className="mt-2 text-sm text-slate-400">Todavía no hay datos este año.</p>;
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead className={`${colorCabecera} text-center text-white`}>
          <tr>
            <th className="whitespace-nowrap px-3 py-2 text-left">&nbsp;</th>
            {NOMBRES_MES.map((m) => (
              <th key={m} className="whitespace-nowrap px-2 py-2">{m}</th>
            ))}
            <th className="whitespace-nowrap px-3 py-2">Total anual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filas.map((f) => (
            <tr key={f.etiqueta} className={`${colorFranja} ${f.total > 0 ? "" : "text-slate-300"}`}>
              <td className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-slate-800">{f.etiqueta}</td>
              {f.porMes.map((v, i) => (
                <td key={i} className="whitespace-nowrap px-2 py-1.5 text-center">{formato(v, f.unidad)}</td>
              ))}
              <td className={`whitespace-nowrap px-3 py-1.5 text-center font-semibold ${f.total > 0 ? colorTotal : ""}`}>
                {formato(f.total, f.unidad)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
