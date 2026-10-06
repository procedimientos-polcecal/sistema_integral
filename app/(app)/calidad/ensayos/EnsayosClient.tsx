"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Select from "@/components/Select";
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
  ultimaMalla: number | null;
  acumuladoFinal: ValorEvaluado;
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
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Humedad (%)</th>
                  <th className="px-3 py-2 text-right">P. vol. (g/l)</th>
                  <th className="px-3 py-2 text-right">Cal útil (%)</th>
                  <th className="px-3 py-2 text-right">Acumulado (%)</th>
                  <th className="px-3 py-2">Observaciones</th>
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
                    <td className="px-3 py-1.5 text-right">
                      <Celda v={f.acumuladoFinal} decimales={1} />
                      {f.ultimaMalla !== null && (
                        <span className="ml-1 text-xs text-slate-400">#{f.ultimaMalla}</span>
                      )}
                    </td>
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
                    <dt className="text-slate-500">P. vol.</dt>
                    <dd>
                      <Celda v={f.pesoVolumetrico} decimales={0} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Cal útil</dt>
                    <dd>
                      <Celda v={f.calUtilVial} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">
                      Ac. {f.ultimaMalla !== null && `#${f.ultimaMalla}`}
                    </dt>
                    <dd>
                      <Celda v={f.acumuladoFinal} decimales={1} />
                    </dd>
                  </div>
                </dl>
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
