"use client";

import Link from "next/link";
import type { CostoDelEquipo as Costo } from "@/lib/mantenimiento/costoEquipo";

/** Un requerimiento, con lo justo para listarlo. */
export interface RequerimientoDelEquipo {
  id: string;
  nro_ri: number;
  descripcion: string;
  costo_iva: number | string | null;
  fecha_pedido: string | null;
  fecha: string | null;
}

export interface CostoDelEquipoProps {
  equipoId: string;
  costo: Costo;
  ultimos: RequerimientoDelEquipo[];
  /** Las ubicaciones de Compras que nombran a esta máquina. */
  ubicaciones: string[];
  /** Si hay alguna tarifa de la hora cargada. Sin ella no hay mano de obra. */
  hayTarifa: boolean;
  /** El sector de la máquina, si tiene compras propias a las que mandar. */
  sectorConCompras: { id: string; nombre: string; codigo: string | null } | null;
}

const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const horas = (n: number) =>
  `${n.toLocaleString("es-AR", { maximumFractionDigits: 0 })} h`;

export default function CostoDelEquipo({
  equipoId, costo, ultimos, ubicaciones, hayTarifa, sectorConCompras,
}: CostoDelEquipoProps) {
  const { huecos } = costo;
  const sinNada = costo.anios.length === 0;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700">Costo de este equipo</h2>
        {ubicaciones.length > 0 && (
          <Link
            href={`/compras/requerimientos?equipo=${equipoId}`}
            className="text-xs text-blue-500 hover:underline"
          >
            Ver sus compras →
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {sinNada ? (
          <p className="px-4 py-4 text-sm text-gray-500">
            Todavía no hay nada costeado para esta máquina.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Año</th>
                    <th className="px-4 py-2 text-right font-medium">Materiales</th>
                    <th className="px-4 py-2 text-right font-medium">Terceros</th>
                    <th className="px-4 py-2 text-right font-medium">Mano de obra</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {costo.anios.map((a) => (
                    <tr key={a.anio}>
                      <td className="px-4 py-2 font-mono text-gray-500">{a.anio}</td>
                      <td className="px-4 py-2 text-right text-gray-700">
                        {a.materiales ? pesos(a.materiales) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700">
                        {a.terceros ? pesos(a.terceros) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700">
                        {a.manoDeObra ? pesos(a.manoDeObra) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">
                        {pesos(a.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-200 bg-gray-50">
                  <tr>
                    <td className="px-4 py-2 text-gray-500">Acumulado</td>
                    <td className="px-4 py-2 text-right text-gray-600">{pesos(costo.materiales)}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{pesos(costo.terceros)}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{pesos(costo.manoDeObra)}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900">{pesos(costo.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {ultimos.length > 0 && (
              <div className="border-t border-gray-100 divide-y divide-gray-100">
                {ultimos.map((r) => (
                  <div key={r.id} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className="text-xs font-mono text-gray-400 w-12 shrink-0 pt-0.5">
                      #{r.nro_ri}
                    </span>
                    <p className="flex-1 min-w-0 text-gray-800 leading-snug">{r.descripcion}</p>
                    <div className="text-right shrink-0">
                      <p className="text-gray-700">
                        {r.costo_iva === null || r.costo_iva === ""
                          ? "—"
                          : pesos(Number(r.costo_iva))}
                      </p>
                      {(r.fecha_pedido ?? r.fecha) && (
                        <p className="text-xs text-gray-400">
                          {new Date(r.fecha_pedido ?? (r.fecha as string)).toLocaleDateString("es-AR")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/**
       * Un costo que se presenta como completo y no lo es, es peor que no
       * mostrarlo. Todo lo que quedó afuera se dice acá, con su tamaño.
       */}
      <ul className="mt-2 space-y-0.5 text-xs text-gray-400">
        <li>
          Son pesos de cada momento, sin ajustar: el acumulado sirve para ordenar
          máquinas entre sí, no para comparar años.
        </li>

        {!hayTarifa && (
          <li className="text-amber-600">
            No hay tarifa de la hora cargada, así que la mano de obra propia no se
            cuenta —decir cero sería decir que es gratis—. Se define en{" "}
            <Link href="/mantenimiento/configuracion" className="underline">
              Configuración
            </Link>
            .
          </li>
        )}

        {huecos.horasSinTarifa > 0 && (
          <li>
            {horas(huecos.horasSinTarifa)} de trabajo propio son anteriores a la
            primera tarifa cargada y no se costearon.
          </li>
        )}

        {huecos.horasDeContratista > 0 && (
          <li>
            {horas(huecos.horasDeContratista)} las hizo un contratista y la orden de
            trabajo no guarda cuánto costaron. Parte de esa plata puede estar en las
            órdenes de servicio de arriba, sin forma de saber cuánta.
          </li>
        )}

        {(huecos.riSinCosto > 0 || huecos.osSinCosto > 0 || huecos.otSinHoras > 0) && (
          <li>
            Sin dato de costo:{" "}
            {[
              huecos.riSinCosto > 0 && `${huecos.riSinCosto} requerimientos`,
              huecos.osSinCosto > 0 && `${huecos.osSinCosto} órdenes de servicio`,
              huecos.otSinHoras > 0 && `${huecos.otSinHoras} órdenes de trabajo sin horas`,
            ]
              .filter(Boolean)
              .join(", ")}
            . No suman cero: no se cuentan.
          </li>
        )}

        {ubicaciones.length === 0 && (
          <li>
            Ninguna ubicación de Compras apunta a esta máquina, así que no hay
            materiales. Se enlaza desde{" "}
            <Link href="/compras/ubicaciones" className="underline">
              Compras → Ubicaciones
            </Link>
            .
          </li>
        )}

        {sectorConCompras && (
          <li>
            Lo que se compró para {sectorConCompras.nombre} sin nombrar una máquina
            no se reparte entre sus equipos.{" "}
            <Link
              href={`/compras/requerimientos?sector=${sectorConCompras.id}`}
              className="underline"
            >
              Verlo aparte
            </Link>
            .
          </li>
        )}
      </ul>
    </section>
  );
}
