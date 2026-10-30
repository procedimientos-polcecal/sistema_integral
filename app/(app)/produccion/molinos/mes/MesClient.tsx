"use client";

import Link from "next/link";
import { comoSeLee, hoyEnArgentina, mesRelativo } from "@/lib/core/fechas";
import { comoSeLeeElTurnoDelRobot, leyendaDelEstado } from "@/lib/produccion/molinos/formato";
import { InsigniaDeEstado, TarjetasDeIndicadores, formatoEntero } from "../Piezas";
import type { MolinoDelMes } from "./page";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function mesLegible(mes: string): string {
  const [anio, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${anio}`;
}

/**
 * Los cinco indicadores de cada molino en un mes.
 *
 * Los días no operativos van **aparte y a la vista**: no están en las horas ni
 * en la utilización —la planta no trabajó, no es un molino parado—, pero tampoco
 * desaparecen: se cuentan y se listan, cada uno con un enlace a su día. Con los
 * turnos que no son normales pasa lo mismo: se cuentan por estado y se listan
 * con su leyenda, no se diluyen en el promedio.
 */
export default function MesClient({ mes, molinos }: { mes: string; molinos: MolinoDelMes[] }) {
  const mesActual = hoyEnArgentina().slice(0, 7);

  return (
    <div className="mx-auto max-w-5xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Molinos del mes</h1>
        <p className="text-sm text-slate-500">
          Lo que midió el PC Robot en cada molino, sumado en el mes. No es el resumen del parte de fábrica:
          aquel cuenta producto terminado y esto cuenta lo que se muele.
        </p>
      </div>

      <div className="card flex items-center justify-between gap-3 p-3">
        <Link
          href={`/produccion/molinos/mes?mes=${mesRelativo(mes, -1)}`}
          aria-label="Mes anterior"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Anterior
        </Link>
        <div className="text-center">
          <div className="text-base font-semibold capitalize text-slate-900">{mesLegible(mes)}</div>
          {mes !== mesActual && (
            <Link href="/produccion/molinos/mes" className="text-xs font-medium text-[var(--primary)] hover:underline">
              Ir a este mes
            </Link>
          )}
        </div>
        <Link
          href={`/produccion/molinos/mes?mes=${mesRelativo(mes, 1)}`}
          aria-label="Mes siguiente"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Siguiente →
        </Link>
      </div>

      {molinos.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">No hay ningún molino activo en el catálogo.</div>
      )}

      {molinos.map(({ id, nombre, mes: d }) => (
        <section key={id} className="space-y-3">
          <h2 className="section-title">{nombre}</h2>

          {d.turnos.length === 0 ? (
            <div className="card p-4 text-sm text-slate-600">
              El robot no informó ningún turno del {nombre} en {mesLegible(mes)}.
            </div>
          ) : (
            <>
              <TarjetasDeIndicadores i={d.indicadores} />

              <div className="card p-4 text-sm text-slate-700">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <span>
                    <strong>{formatoEntero(d.diasConDatos)}</strong> días con datos
                  </span>
                  <span>
                    <strong>{formatoEntero(d.diasNoOperativos.length)}</strong> días no operativos
                  </span>
                </div>
                {d.diasNoOperativos.length > 0 ? (
                  <>
                    <p className="mt-2 text-xs text-slate-500">
                      Días en que el robot no informó ningún turno: la planta no trabajó. Están contados acá y{" "}
                      <strong>no entran</strong> en las horas ni en la utilización de arriba.
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {d.diasNoOperativos.map((f) => (
                        <li key={f}>
                          <Link
                            href={`/produccion/molinos?fecha=${f}`}
                            className="inline-block rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                          >
                            {comoSeLee(f)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Ningún día de este mes quedó sin turnos informados.</p>
                )}
              </div>

              <div className="card p-4">
                <h3 className="text-sm font-semibold text-slate-700">Turnos señalados</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {formatoEntero(d.conteoPorEstado.acumulado)} acumulados · {formatoEntero(d.conteoPorEstado.inconsistente)} inconsistentes ·{" "}
                  {formatoEntero(d.conteoPorEstado.huerfano)} sin informar · de {formatoEntero(d.turnos.length)} turnos del robot.
                </p>
                {d.senalados.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">Todos los turnos del mes son normales.</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-2 py-1 text-left">Día</th>
                          <th className="px-2 py-1 text-left">Turno del robot</th>
                          <th className="px-2 py-1 text-left">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {d.senalados.map((t) => (
                          <FilaSenalada key={`${t.fecha}|${t.turno}`} t={t} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

function FilaSenalada({ t }: { t: MolinoDelMes["mes"]["senalados"][number] }) {
  const leyenda = leyendaDelEstado(t.estado, t);
  return (
    <>
      <tr>
        <td className="px-2 py-1.5">
          <Link href={`/produccion/molinos?fecha=${t.fecha}`} className="underline">
            {comoSeLee(t.fecha)}
          </Link>
        </td>
        <td className="px-2 py-1.5 font-mono tabular-nums">{comoSeLeeElTurnoDelRobot(t.turno)}</td>
        <td className="px-2 py-1.5">
          <InsigniaDeEstado estado={t.estado} />
        </td>
      </tr>
      {leyenda && (
        <tr>
          <td colSpan={3} className="px-2 pb-2 text-xs text-slate-600">{leyenda}</td>
        </tr>
      )}
    </>
  );
}
