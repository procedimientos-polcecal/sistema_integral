"use client";

import { useMemo, useState } from "react";
import InfoTip from "@/components/InfoTip";
import Link from "next/link";
import Select from "@/components/Select";
import { MALLAS_DEL_LISTADO } from "@/lib/calidad/ensayos/granulometria";
import type { ValorEvaluado } from "@/lib/calidad/ensayos/types";

export interface FilaDeEnsayo {
  id: string;
  fecha: string;
  producto_id: string;
  producto: string;
  observaciones: string | null;
  humedad: ValorEvaluado;
  pesoVolumetrico: ValorEvaluado;
  calUtilVial: ValorEvaluado;
  /**
   * El acumulado de cada columna, alineado con `MALLAS_DEL_LISTADO`.
   *
   * Siempre cuatro lugares; `null` es que ahí no va número — porque el producto
   * no muestra esa malla, o porque no se midió. Lo decide
   * `acumuladosDelListado`, en el servidor.
   */
  acumulados: (ValorEvaluado | null)[];
  problemaDeGranulometria?: string;
  hayFueraDeLimite: boolean;
}

function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

/**
 * Una celda de resultado.
 *
 * Rojo es fuera de límite; ámbar es un problema de cálculo —humedad negativa,
 * división por cero—; y un guión es "no se midió", que es un dato distinto de
 * cero. Esa última distinción es la que el Excel perdía: ahí "no se midió" se
 * escribía de seis formas, `-`, `-%`, `#DIV/0!` y vacío entre ellas.
 */
function Celda({ v, decimales = 2 }: { v: ValorEvaluado; decimales?: number }) {
  if (v.valor === null) {
    return (
      <span className={v.problema ? "text-amber-700" : "text-slate-300"} title={v.problema}>
        {v.problema ? "!" : "—"}
      </span>
    );
  }
  return (
    <span
      className={v.fuera ? "font-semibold text-red-700" : v.problema ? "text-amber-700" : ""}
      title={v.problema ?? (v.fuera === "alto" ? "Por encima del límite" : v.fuera === "bajo" ? "Por debajo del límite" : undefined)}
    >
      {v.valor.toLocaleString("es-AR", { maximumFractionDigits: decimales })}
    </span>
  );
}

export default function EnsayosClient({
  filas,
  productos,
  puedeEditar,
  hayLimites,
  dias,
}: {
  filas: FilaDeEnsayo[];
  productos: { id: string; nombre: string }[];
  puedeEditar: boolean;
  hayLimites: boolean;
  dias: number;
}) {
  const [producto, setProducto] = useState("");
  const [mes, setMes] = useState("");

  const visibles = useMemo(
    () =>
      filas.filter(
        (f) => (!producto || f.producto_id === producto) && (!mes || f.fecha.startsWith(mes))
      ),
    [filas, producto, mes]
  );

  const fueraDeLimite = visibles.filter((f) => f.hayFueraDeLimite).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Ensayos</h1>
          <p className="text-sm text-slate-500">
            {visibles.length} de {filas.length} muestras de los últimos {dias} días.{" "}
            {/* Cero desvíos y "nadie cargó un límite" no se parecen en nada. */}
            {hayLimites ? (
              <span className={fueraDeLimite > 0 ? "font-semibold text-red-700" : ""}>
                {fueraDeLimite} fuera de límite.
              </span>
            ) : (
              <span className="text-amber-700">Sin límites cargados: nada se marca.</span>
            )}
            <InfoTip className="ml-1" text="Rojo es fuera de un límite cargado. Ámbar es un problema de cálculo —humedad negativa, peso inicial que no supera al del recipiente, retenidos que superan el peso de la muestra—: se muestra y no se recorta. Un guión es que no se midió, no que dio cero. Los límites son por producto: uno que no tiene ninguno no se marca nunca, aunque otros sí." />
          </p>
        </div>

        {puedeEditar && (
          <Link
            href="/calidad/ensayos/nueva"
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            Cargar muestra
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={producto}
          onChange={(e) => setProducto(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Todos los productos</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Select>
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </div>

      {visibles.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
          No hay muestras cargadas en este período.
        </p>
      ) : (
        <>
          {/* Tabla en pantalla ancha. */}
          <div className="hidden overflow-x-auto rounded border border-slate-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 pt-2" rowSpan={2}>Fecha</th>
                  <th className="px-3 pt-2" rowSpan={2}>Producto</th>
                  <th className="px-3 pt-2 text-right" rowSpan={2}>Humedad (%)</th>
                  <th className="px-3 pt-2 text-right" rowSpan={2}>
                    P. vol. (g/l)
                    <InfoTip className="ml-1 normal-case tracking-normal" text="Gramos × 1000 ÷ volumen del recipiente, en g/l. El volumen es un dato de cada muestra: viene propuesto en 330 cc, que es el recipiente real, y queda dicho con cuál se midió." />
                  </th>
                  <th className="px-3 pt-2 text-right" rowSpan={2}>
                    Cal útil (%)
                    <InfoTip className="ml-1 normal-case tracking-normal" text="ml de ácido × 0,037 ÷ peso de la muestra titulada, en %. El peso queda guardado con cada muestra y viene propuesto en 3 g, que es sobre lo que se tituló hasta ahora; 0,037 es la constante del método." />
                  </th>
                  {/* Las cuatro van bajo un solo título: son la misma medición
                      en cuatro tamices, no cuatro determinaciones distintas. */}
                  <th className="border-x border-slate-200 px-3 pt-2 text-center" colSpan={MALLAS_DEL_LISTADO.length}>
                    Acumulado (%)
                    <InfoTip className="ml-1 normal-case tracking-normal" text="Cuántas columnas se llenan lo decide el producto y no la muestra: los que declaran la malla #325 en su juego muestran las cuatro y el resto, como los Calcios, sólo la #200. En blanco es que ese producto no muestra esa malla o que no se midió, y nunca se cae a la malla de al lado. El #200 de un Filler suma tres tamices y el de un Calcio, ocho: no significan lo mismo." />
                  </th>
                  <th className="px-3 pt-2" rowSpan={2}>Observaciones</th>
                </tr>
                <tr>
                  {MALLAS_DEL_LISTADO.map((malla, i) => (
                    <th
                      key={malla}
                      className={`px-3 pb-2 text-right font-normal normal-case tracking-normal text-slate-400 ${
                        i === 0 ? "border-l border-slate-200" : ""
                      } ${i === MALLAS_DEL_LISTADO.length - 1 ? "border-r border-slate-200" : ""}`}
                    >
                      #{malla}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibles.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5">
                      <Link href={`/calidad/ensayos/${f.id}`} className="text-slate-900 underline">
                        {comoSeLee(f.fecha)}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">{f.producto}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Celda v={f.humedad} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Celda v={f.pesoVolumetrico} decimales={0} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Celda v={f.calUtilVial} />
                    </td>
                    {/* En blanco cuando el producto no muestra esa malla o
                        cuando no se midió. Un cero ahí diría "no quedó nada". */}
                    {f.acumulados.map((v, i) => (
                      <td
                        key={MALLAS_DEL_LISTADO[i]}
                        className={`px-3 py-1.5 text-right tabular-nums ${
                          i === 0 ? "border-l border-slate-100" : ""
                        } ${i === f.acumulados.length - 1 ? "border-r border-slate-100" : ""}`}
                      >
                        {v ? <Celda v={v} decimales={1} /> : null}
                      </td>
                    ))}
                    <td className="max-w-48 truncate px-3 py-1.5 text-slate-500" title={f.observaciones ?? ""}>
                      {f.observaciones}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en el teléfono: la tabla no entra y recortarla miente. */}
          <ul className="space-y-2 md:hidden">
            {visibles.map((f) => (
              <li key={f.id} className="rounded border border-slate-200 bg-white p-3">
                <Link href={`/calidad/ensayos/${f.id}`} className="flex justify-between">
                  <span className="font-semibold text-slate-900">{f.producto}</span>
                  <span className="text-sm text-slate-500">{comoSeLee(f.fecha)}</span>
                </Link>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Humedad</dt>
                    <dd>
                      <Celda v={f.humedad} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">
                      P. vol.
                      <InfoTip className="ml-1" text="Gramos × 1000 ÷ volumen del recipiente, en g/l. El volumen es un dato de cada muestra: viene propuesto en 330 cc, que es el recipiente real, y queda dicho con cuál se midió." />
                    </dt>
                    <dd>
                      <Celda v={f.pesoVolumetrico} decimales={0} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">
                      Cal útil
                      <InfoTip className="ml-1" text="ml de ácido × 0,037 ÷ peso de la muestra titulada, en %. El peso queda guardado con cada muestra y viene propuesto en 3 g, que es sobre lo que se tituló hasta ahora; 0,037 es la constante del método." />
                    </dt>
                    <dd>
                      <Celda v={f.calUtilVial} />
                    </dd>
                  </div>
                </dl>

                {/* El acumulado va en su propia fila y no en la grilla de dos
                    columnas: son hasta cuatro números y comparten título. */}
                {f.acumulados.some((v) => v) && (
                  <div className="mt-1 border-t border-slate-100 pt-1">
                    <p className="text-xs text-slate-500">
                      Acumulado (%)
                      <InfoTip className="ml-1" text="Cuántas columnas se llenan lo decide el producto y no la muestra: los que declaran la malla #325 en su juego muestran las cuatro y el resto, como los Calcios, sólo la #200. En blanco es que ese producto no muestra esa malla o que no se midió, y nunca se cae a la malla de al lado. El #200 de un Filler suma tres tamices y el de un Calcio, ocho: no significan lo mismo." />
                    </p>
                    <div className="flex flex-wrap gap-x-4 text-sm">
                      {f.acumulados.map((v, i) =>
                        v ? (
                          <span key={MALLAS_DEL_LISTADO[i]} className="tabular-nums">
                            <span className="text-slate-400">#{MALLAS_DEL_LISTADO[i]}</span>{" "}
                            <Celda v={v} decimales={1} />
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>
                )}
                {f.observaciones && (
                  <p className="mt-1 text-xs text-slate-500">{f.observaciones}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
