"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { tipoDeAcarreo, ETIQUETA_UNIDAD, type FilaResumenFletero, type FilaToneladasPorYacimiento } from "@/lib/cantera/acarreo";
import type { Fletero } from "@/lib/cantera/types";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const money = (v: number) => `$ ${ars.format(v)}`;

export default function AcarreoClient({
  mes,
  resumenes,
  toneladas,
  totalGeneral,
  puedeEditar,
  esAdmin,
}: {
  mes: string;
  resumenes: { fletero: Fletero; resumen: FilaResumenFletero }[];
  toneladas: FilaToneladasPorYacimiento[];
  totalGeneral: number;
  puedeEditar: boolean;
  esAdmin: boolean;
}) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Acarreo</h1>
        <div className="flex items-center gap-2">
          {esAdmin && (
            <>
              <Link href="/cantera/fleteros" className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">Fleteros</Link>
              <Link href="/cantera/tarifas-acarreo" className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">Tarifas</Link>
            </>
          )}
          {puedeEditar && (
            <Link href={`/cantera/acarreo/cargar?mes=${mes}`} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
              Cargar acarreo
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <span className="text-slate-500">Mes:</span>
        <input
          type="month"
          className="rounded border border-slate-300 px-2 py-1"
          value={mes}
          onChange={(e) => e.target.value && router.push(`/cantera/acarreo?mes=${e.target.value}`)}
        />
      </div>

      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Por fletero</h2>
          <span className="text-sm font-medium">Total: {money(totalGeneral)}</span>
        </div>
        <div className="mt-2 space-y-2">
          {resumenes.map(({ fletero, resumen }) => (
            <details key={fletero.id} className="rounded-lg border border-slate-200 p-3">
              <summary className="flex cursor-pointer items-center justify-between text-sm">
                <span className="font-medium">
                  {fletero.nombre} {fletero.patente && <span className="font-mono text-xs text-slate-400">{fletero.patente}</span>}
                </span>
                <span>{money(resumen.totalMonto)}</span>
              </summary>
              <table className="mt-3 w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {resumen.porTipo.map((p) => (
                    <tr key={p.tipo}>
                      <td className="py-1 text-slate-600">{tipoDeAcarreo(p.tipo)?.etiqueta ?? p.tipo}</td>
                      <td className="py-1 text-right">{num.format(p.cantidad)} {tipoDeAcarreo(p.tipo) && ETIQUETA_UNIDAD[tipoDeAcarreo(p.tipo)!.unidad]}</td>
                      <td className="py-1 text-right font-medium">{p.monto === null ? <span className="text-amber-700">sin tarifa</span> : money(p.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
          {resumenes.length === 0 && (
            <p className="rounded-lg border border-slate-200 p-4 text-center text-sm text-slate-400">Sin acarreo cargado este mes.</p>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">Toneladas por yacimiento</h2>
        <p className="text-xs text-slate-500">No incluye "Caliza": puede venir de C1 o de C3 y la carga no distingue cuál.</p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {toneladas.filter((t) => t.mes === mes).map((t) => (
            <div key={t.yacimientoCodigo} className="rounded-lg border border-slate-200 p-3 text-center">
              <div className="text-lg font-semibold">{num.format(t.toneladas)}</div>
              <div className="text-xs text-slate-500">{t.yacimientoCodigo}</div>
            </div>
          ))}
          {toneladas.filter((t) => t.mes === mes).length === 0 && (
            <p className="col-span-full text-sm text-slate-400">Sin datos este mes.</p>
          )}
        </div>
      </section>
    </div>
  );
}
