"use client";

import { monedaExacta, fecha } from "@/lib/compras/constants";
import { diferenciaPorcentual, detalleCotizacion } from "@/lib/compras/comparativa";
import type { Cotizacion } from "@/lib/compras/types";

/**
 * La comparativa mientras Compras la arma.
 *
 * Acá el trabajo es administrar filas —agregar, revisar, borrar—, no decidir.
 * Por eso una fila por proveedor: es compacta, aguanta cualquier cantidad de
 * presupuestos y la acción de borrar cae donde se la espera. La comparación
 * atributo por atributo aparece después, cuando el RI pasa a "Para comprar" y
 * lo abre quien tiene que elegir.
 */
export default function ComparativaTabla({
  cotizaciones, minimo, puedeBorrar, onBorrar,
}: {
  /** Ya ordenadas por total. */
  cotizaciones: Cotizacion[];
  minimo: number | null;
  puedeBorrar: boolean;
  onBorrar: (c: Cotizacion) => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Proveedor</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-left">Pago</th>
            <th className="px-3 py-2 text-left">Entrega</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cotizaciones.map((c) => {
            const vencido = c.precio_hasta !== null && c.precio_hasta < hoy;
            const dif = diferenciaPorcentual(c.precio_total, minimo);
            return (
              <tr key={c.id} className={c.elegida ? "bg-green-50" : ""}>
                <td className="px-3 py-2">
                  <div className={c.elegida ? "font-semibold" : ""}>
                    {c.proveedores?.nombre ?? "—"}
                    {c.elegida && <span className="ml-1.5 text-xs text-green-700">✓ elegida</span>}
                    {c.origen === "drive" && (
                      <span className="ml-1.5 text-xs text-slate-400">de la planilla</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{detalleCotizacion(c)}</div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="font-mono font-semibold">{monedaExacta(c.precio_total)}</div>
                  <div className="text-xs">
                    {dif ? (
                      <span className="text-slate-400">{dif}</span>
                    ) : (
                      <span className="text-green-700">más barato</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {c.plazo_pago_dias === null
                    ? "—"
                    : c.plazo_pago_dias === 0
                      ? "contado"
                      : `${c.plazo_pago_dias} días`}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  <div>{c.disponibilidad ?? "—"}</div>
                  {c.precio_hasta && (
                    <div className={`text-xs ${vencido ? "text-red-600" : "text-slate-400"}`}>
                      vale hasta {fecha(c.precio_hasta)}
                      {vencido && " · vencido"}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {puedeBorrar && (
                    <button
                      onClick={() => onBorrar(c)}
                      className="text-xs text-slate-400 hover:text-red-600"
                    >
                      Borrar
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
