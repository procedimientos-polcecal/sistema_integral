"use client";

import { useMemo, useState } from "react";
import {
  resumirPorGrupo,
  type ArticuloDelInforme, type MovimientoDelInforme,
} from "@/lib/calidad/envases/informe";

/** El primer día del mes en curso, que es el rango que se mira casi siempre. */
function arranque(): { desde: string; hasta: string } {
  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { desde: iso(primero), hasta: iso(hoy) };
}

export default function PeriodoClient({
  articulos, movimientos,
}: {
  articulos: ArticuloDelInforme[];
  movimientos: MovimientoDelInforme[];
}) {
  const inicial = useMemo(arranque, []);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);

  const filas = useMemo(
    () => resumirPorGrupo(articulos, movimientos, { desde, hasta }),
    [articulos, movimientos, desde, hasta]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Envases por período</h1>
        <p className="text-sm text-slate-500">
          Lo que entró y salió de cada grupo entre las dos fechas.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                 className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
      </div>

      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Grupo</th>
              <th className="px-3 py-2 text-right">Ingresos</th>
              <th className="px-3 py-2 text-right">Egresos</th>
              <th className="px-3 py-2 text-right">Rotura</th>
              <th className="px-3 py-2 text-right">Despacho</th>
              <th className="px-3 py-2 text-right">Stock hoy</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.grupo ?? "sin-grupo"} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-900">
                  {f.grupo ?? <span className="italic text-slate-500">Sin grupo</span>}
                  <span className="ml-2 text-xs text-slate-400">
                    {f.articulos} {f.articulos === 1 ? "artículo" : "artículos"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{f.ingresos}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.egresos}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.rotura}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.despacho}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{f.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Las dos aclaraciones van en la pantalla y no sólo en el código: la
          primera la lleva la planilla al pie, y sin la segunda el primero que
          compare las dos tablas reporta un bug del SdG que no existe. */}
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>
          <strong>El stock es el de hoy</strong>, no la diferencia entre los ingresos y
          los egresos del período.
        </p>
        <p>
          Los bolsones nuevos se cuentan en <strong>un solo grupo</strong>. La planilla los
          cuenta en dos —agrupa por el texto de la descripción, y
          &ldquo;NUEVOS … (1,20 P 02)&rdquo; cae en los dos lados—, así que sus totales van a
          ser más altos que estos.
        </p>
      </div>
    </div>
  );
}
