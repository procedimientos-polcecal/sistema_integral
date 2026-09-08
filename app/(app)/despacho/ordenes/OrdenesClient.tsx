"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { comoSeLee } from "@/lib/core/fechas";
import { ETIQUETA_DE_ESTADO, comoSeLeenLosMinutos } from "@/lib/despacho/orden";
import { ENVASES, MATERIALES } from "@/lib/despacho/clasificacion";
import {
  HISTORICO_SIN_FILTROS,
  escribirFiltrosDelHistorico,
  hayFiltrosDelHistorico,
} from "@/lib/despacho/filtrosUrl";
import type { FiltrosDeHistorico } from "@/lib/despacho/filtrosUrl";
import type { DatosDelHistorico } from "./page";

/**
 * El histórico y los indicadores.
 *
 * Los tres números de arriba dicen **sobre cuántas órdenes están hechos**. Un
 * promedio sin eso es un número sin escala: "38 min" calculado sobre tres
 * órdenes de un mes de doscientas es lo que alguien va a usar para decidir algo.
 *
 * Los filtros viven en la URL, así que un enlace a "todo lo que salió a granel
 * en agosto" se puede mandar por chat.
 */

export default function OrdenesClient({ datos }: { datos: DatosDelHistorico }) {
  const router = useRouter();
  const [f, setF] = useState<FiltrosDeHistorico>(datos.filtros);

  function aplicar(nuevos: FiltrosDeHistorico) {
    setF(nuevos);
    const query = escribirFiltrosDelHistorico(nuevos);
    router.push(query ? `/despacho/ordenes?${query}` : "/despacho/ordenes");
  }

  const { indicadores: ind } = datos;

  return (
    <div className="mx-auto max-w-6xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Órdenes de carga</h1>
        <p className="text-sm text-slate-500">
          {ind.cantidad} {ind.cantidad === 1 ? "orden" : "órdenes"}
          {hayFiltrosDelHistorico(f) && " con los filtros puestos"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador
          titulo="Tiempo de carga"
          minutos={ind.promedioCarga}
          sobre={ind.cantidad - ind.sinTiempoDeCarga}
          de={ind.cantidad}
        />
        <Indicador
          titulo="Tiempo en predio"
          minutos={ind.promedioPredio}
          sobre={ind.cantidad - ind.sinTiempoEnPredio}
          de={ind.cantidad}
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Los que más tardaron</div>
          {ind.peoresEnPredio.length === 0 ? (
            <div className="mt-2 text-sm text-slate-400">Nada que mostrar todavía.</div>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {ind.peoresEnPredio.map((p) => (
                <li key={p.numero} className="flex justify-between gap-2">
                  <span className="truncate text-slate-600">
                    <span className="font-medium text-slate-900">{p.numero}</span>{" "}
                    {p.cliente ?? ""}
                  </span>
                  <span className="shrink-0 font-medium text-slate-700">
                    {comoSeLeenLosMinutos(p.minutos)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Cliente</span>
          <input
            value={f.cliente}
            onChange={(e) => setF({ ...f, cliente: e.target.value })}
            onBlur={() => aplicar(f)}
            onKeyDown={(e) => e.key === "Enter" && aplicar(f)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Material</span>
          <select
            value={f.material}
            onChange={(e) => aplicar({ ...f, material: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {MATERIALES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Envase</span>
          <select
            value={f.envase}
            onChange={(e) => aplicar({ ...f, envase: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {ENVASES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Empresa</span>
          <select
            value={f.empresa}
            onChange={(e) => aplicar({ ...f, empresa: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Las dos</option>
            {datos.empresas.map((e) => (
              <option key={e.id} value={e.nombre}>{e.nombre}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Desde</span>
          <input
            type="date"
            value={f.desde}
            onChange={(e) => aplicar({ ...f, desde: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Hasta</span>
          <input
            type="date"
            value={f.hasta}
            onChange={(e) => aplicar({ ...f, hasta: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        {hayFiltrosDelHistorico(f) && (
          <button
            onClick={() => aplicar(HISTORICO_SIN_FILTROS)}
            className="self-end text-sm text-slate-500 underline hover:text-slate-700 sm:col-span-3 lg:col-span-6 lg:text-left"
          >
            Limpiar los filtros
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Nº</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">Material</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-right">Carga</th>
                <th className="px-3 py-2 text-right">En predio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {datos.filas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                    {hayFiltrosDelHistorico(f)
                      ? "Ninguna orden con esos filtros."
                      : "Todavía no hay órdenes de carga."}
                  </td>
                </tr>
              ) : (
                datos.filas.map((fila) => (
                  <tr key={fila.orden.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">{comoSeLee(fila.orden.fecha)}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {fila.orden.numero}
                      {!fila.orden.odoo_picking_name && (
                        <div className="text-xs font-normal text-amber-600">sin remito</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{fila.orden.cliente_raw ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {fila.producto}
                      {fila.sinClasificar && (
                        <div className="text-xs text-amber-600">sin clasificar</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {fila.orden.cantidad !== null
                        ? `${fila.orden.cantidad} ${fila.orden.unidad ?? ""}`.trim()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {ETIQUETA_DE_ESTADO[fila.estado]}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        (fila.minutosDeCarga ?? 0) < 0 ? "font-semibold text-red-600" : "text-slate-600"
                      }`}
                    >
                      {comoSeLeenLosMinutos(fila.minutosDeCarga)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        (fila.minutosEnPredio ?? 0) < 0 ? "font-semibold text-red-600" : "text-slate-600"
                      }`}
                    >
                      {comoSeLeenLosMinutos(fila.minutosEnPredio)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Un promedio con la escala al lado.
 *
 * "38 min" no dice nada sin saber sobre cuántas órdenes está hecho: si son 3 de
 * 200, el número es una anécdota. Y cuando no hay ninguna, dice que no se sabe
 * en vez de mostrar un cero.
 */
function Indicador({
  titulo,
  minutos,
  sobre,
  de,
}: {
  titulo: string;
  minutos: number | null;
  sobre: number;
  de: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">
        {minutos === null ? "—" : comoSeLeenLosMinutos(Math.round(minutos))}
      </div>
      <div className="text-xs text-slate-400">
        {minutos === null
          ? "ninguna orden con los dos horarios"
          : `promedio de ${sobre} de ${de} órdenes`}
      </div>
    </div>
  );
}
