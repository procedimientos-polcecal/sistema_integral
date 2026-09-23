"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import {
  tipoDeAcarreo,
  ETIQUETA_UNIDAD,
  type FilaResumenFletero,
  type FilaToneladasPorYacimiento,
  type FilaTotalPorTipo,
  type MatrizPorDestino,
  type DetalleDiarioPorDestino,
} from "@/lib/cantera/acarreo";
import type { Fletero } from "@/lib/cantera/types";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const money = (v: number) => `$ ${ars.format(v)}`;
const cantidad = (v: number) => (v > 0 ? ars.format(v) : "-");

const COLOR_YACIMIENTO: Record<string, string> = {
  D1: "#1E7D34",
  D6: "#0891B2",
  C1: "#E8A020",
  C3: "#7E22CE",
};

/** El mes anterior/siguiente a "YYYY-MM", sin líos de zona horaria. */
function moverMes(mes: string, delta: number): string {
  const [anio, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(anio, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
function nombreDeMes(mes: string): string {
  const texto = NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export default function AcarreoClient({
  mes,
  resumenes,
  toneladas,
  totalesDelMes,
  totalGeneral,
  puedeEditar,
  esAdmin,
  sinFleteroResuelto,
  matrizMaterialDestino,
  detalleDiario,
}: {
  mes: string;
  resumenes: { fletero: Fletero; resumen: FilaResumenFletero }[];
  toneladas: FilaToneladasPorYacimiento[];
  totalesDelMes: FilaTotalPorTipo[];
  totalGeneral: number;
  puedeEditar: boolean;
  esAdmin: boolean;
  /** Pesadas del mes cuyo fletero no se pudo reconocer (nombre ambiguo o desconocido). */
  sinFleteroResuelto: number;
  matrizMaterialDestino: MatrizPorDestino;
  detalleDiario: DetalleDiarioPorDestino;
}) {
  const router = useRouter();

  const irA = (m: string) => router.push(`/cantera/acarreo?mes=${m}`);
  const toneladasDelMes = toneladas.filter((t) => t.mes === mes);
  const totalToneladas = totalesDelMes.filter((t) => t.unidad === "tonelada").reduce((s, t) => s + t.cantidad, 0);
  const maxTipo = Math.max(1, ...totalesDelMes.map((t) => t.cantidad));

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-header">Acarreo</h1>
        <div className="flex items-center gap-2">
          {esAdmin && (
            <>
              <Link href="/cantera/fleteros" className="btn-secondary">Fleteros</Link>
              <Link href="/cantera/tarifas-acarreo" className="btn-secondary">Tarifas</Link>
            </>
          )}
          {puedeEditar && (
            <Link href={`/cantera/acarreo/cargar?mes=${mes}`} className="btn-primary">Cargar datos</Link>
          )}
        </div>
      </div>

      {/* ── Navegador de mes ── */}
      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => irA(moverMes(mes, -1))} className="btn-ghost !px-2" aria-label="Mes anterior">←</button>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-1.5">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{nombreDeMes(mes)}</span>
          <input
            type="month"
            className="w-0 flex-1 border-none bg-transparent p-0 text-xs text-[var(--text-muted)] outline-none"
            value={mes}
            onChange={(e) => e.target.value && irA(e.target.value)}
          />
        </div>
        <button onClick={() => irA(moverMes(mes, 1))} className="btn-ghost !px-2" aria-label="Mes siguiente">→</button>
      </div>

      {sinFleteroResuelto > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {sinFleteroResuelto} pesada(s) de este mes tienen un fletero que no se pudo reconocer (nombre ambiguo o
          que no está en la lista) — no entran en ningún total. Revisar en "Datos" de la planilla de balanza.
        </p>
      )}

      {/* ── KPIs del mes ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard color="#0891B2" label="Acarreo a pagar" value={money(totalGeneral)} />
        <KpiCard color="#1E7D34" label="Toneladas del mes" value={num.format(totalToneladas)} />
        <KpiCard color="#7E22CE" label="Fleteros con movimiento" value={String(resumenes.length)} />
        <KpiCard
          color={sinFleteroResuelto > 0 ? "#B45309" : "#1E7D34"}
          label="Pesadas sin fletero"
          value={String(sinFleteroResuelto)}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── Por fletero ── */}
        <section className="card p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="section-title">Por fletero</h2>
            <span className="text-sm font-semibold text-[var(--text-primary)]">{money(totalGeneral)}</span>
          </div>
          <div className="mt-3 space-y-2">
            {resumenes.map(({ fletero, resumen }) => {
              const pct = totalGeneral > 0 ? Math.round((resumen.totalMonto / totalGeneral) * 100) : 0;
              return (
                <details key={fletero.id} className="group rounded-lg border border-[var(--border)] p-3 open:bg-[#FAFBFC]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 truncate">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-light)] text-[11px] font-bold text-[var(--primary-dark)]">
                        {fletero.nombre.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="truncate">
                        <span className="font-medium text-[var(--text-primary)]">{fletero.nombre}</span>{" "}
                        {fletero.patente && <span className="font-mono text-xs text-[var(--text-muted)]">{fletero.patente}</span>}
                      </span>
                    </span>
                    <span className="whitespace-nowrap font-semibold text-[var(--text-primary)]">{money(resumen.totalMonto)}</span>
                  </summary>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
                    <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                  </div>
                  <table className="mt-3 w-full text-xs">
                    <tbody className="divide-y divide-[var(--border)]">
                      {resumen.porTipo.map((p) => (
                        <tr key={p.tipo}>
                          <td className="py-1.5 text-[var(--text-secondary)]">{tipoDeAcarreo(p.tipo)?.etiqueta ?? p.tipo}</td>
                          <td className="py-1.5 text-right text-[var(--text-muted)]">
                            {num.format(p.cantidad)} {tipoDeAcarreo(p.tipo) && ETIQUETA_UNIDAD[tipoDeAcarreo(p.tipo)!.unidad]}
                          </td>
                          <td className="py-1.5 text-right font-medium">
                            {p.monto === null ? <span className="text-amber-700">sin tarifa</span> : money(p.monto)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              );
            })}
            {resumenes.length === 0 && <p className="empty-state">Sin acarreo cargado este mes.</p>}
          </div>
        </section>

        {/* ── Total del mes, por tipo (ranking) ── */}
        <section className="card p-4">
          <h2 className="section-title">Total del mes, por tipo</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Todos los fleteros juntos — sólo lo que tuvo movimiento.</p>
          {totalesDelMes.length === 0 ? (
            <p className="empty-state mt-3">Sin movimiento este mes.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {totalesDelMes.map((t) => (
                <div key={t.tipo}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-[var(--text-secondary)]">{t.etiqueta}</span>
                    <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">
                      <span className="font-bold text-[var(--text-primary)]">{num.format(t.cantidad)}</span> {ETIQUETA_UNIDAD[t.unidad]}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--bg)]">
                    <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${(t.cantidad / maxTipo) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Toneladas por yacimiento ── */}
      <section className="card mt-5 p-4">
        <h2 className="section-title">Toneladas por yacimiento</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Por el origen real de cada pesada — todos los materiales, incluida Caliza.</p>
        {toneladasDelMes.length === 0 ? (
          <p className="empty-state mt-3">Sin datos este mes.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {toneladasDelMes.map((t) => {
              const color = COLOR_YACIMIENTO[t.yacimientoCodigo] ?? "#64748B";
              const pct = totalToneladas > 0 ? Math.round((t.toneladas / totalToneladas) * 100) : 0;
              return (
                <div key={t.yacimientoCodigo} className="relative overflow-hidden rounded-xl border border-[var(--border)] p-3">
                  <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="text-xs font-medium text-[var(--text-muted)]">{t.yacimientoCodigo}</span>
                  </div>
                  <div className="mt-1 text-xl font-bold text-[var(--text-primary)]">{num.format(t.toneladas)}</div>
                  <div className="text-xs text-[var(--text-muted)]">{pct}% del total</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Material / destino ── */}
      <section className="card mt-5 p-4">
        <h2 className="section-title">Material / destino</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Sólo lo que sale de una pesada real — horas, viajes y Materiales Pezzuchi no traen destino.
        </p>
        {matrizMaterialDestino.filas.length === 0 ? (
          <p className="empty-state mt-3">Sin datos este mes.</p>
        ) : (
          <TablaMatriz
            columnas={matrizMaterialDestino.destinos}
            filas={matrizMaterialDestino.filas.map((f) => ({ id: f.tipo, etiqueta: f.etiqueta, porColumna: f.porDestino }))}
            totales={matrizMaterialDestino.totalesPorDestino}
          />
        )}
      </section>

      {/* ── Detalle diario ── */}
      <section className="card mt-5 p-4">
        <h2 className="section-title">Detalle diario</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Por fecha y material, cruzado por destino — un renglón por día, no por camión.</p>
        {detalleDiario.filas.length === 0 ? (
          <p className="empty-state mt-3">Sin datos este mes.</p>
        ) : (
          <TablaMatriz
            columnas={detalleDiario.destinos}
            filas={detalleDiario.filas.map((f, i) => ({ id: String(i), fecha: f.fecha, etiqueta: f.etiqueta, porColumna: f.porDestino }))}
            desplazable
          />
        )}
      </section>
    </div>
  );
}

/**
 * Material/fecha × destino, con el fondo de cada celda teñido según qué tan
 * grande es el número frente al máximo de la tabla — para que un vistazo
 * rápido diga dónde está el volumen sin tener que leer cada celda, como un
 * mapa de calor de planta.
 */
function TablaMatriz({
  columnas,
  filas,
  totales,
  primeraColumna = "Material",
  desplazable = false,
}: {
  columnas: string[];
  filas: { id: string; etiqueta: string; fecha?: string; porColumna: Record<string, number> }[];
  totales?: Record<string, number>;
  primeraColumna?: string;
  desplazable?: boolean;
}) {
  const max = Math.max(1, ...filas.flatMap((f) => columnas.map((c) => f.porColumna[c])));
  const tinte = (v: number) => (v > 0 ? `rgba(30,125,52,${0.06 + (v / max) * 0.34})` : undefined);

  return (
    <div className={`mt-3 overflow-x-auto rounded-lg border border-[var(--border)] ${desplazable ? "max-h-96 overflow-y-auto" : ""}`}>
      <table className="w-full text-sm">
        <thead className={desplazable ? "sticky top-0 z-10" : undefined}>
          <tr>
            {filas[0]?.fecha !== undefined && (
              <th className="whitespace-nowrap bg-[#F8FAFC] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Fecha</th>
            )}
            <th className="whitespace-nowrap bg-[#F8FAFC] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {primeraColumna}
            </th>
            {columnas.map((c) => (
              <th key={c} className="whitespace-nowrap bg-[#F8FAFC] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {filas.map((f) => (
            <tr key={f.id}>
              {f.fecha !== undefined && <td className="whitespace-nowrap px-3 py-1.5 text-[var(--text-secondary)]">{f.fecha}</td>}
              <td className="whitespace-nowrap px-3 py-1.5 font-medium text-[var(--text-primary)]">{f.etiqueta}</td>
              {columnas.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums" style={{ background: tinte(f.porColumna[c]) }}>
                  {cantidad(f.porColumna[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totales && (
          <tfoot>
            <tr className="border-t-2 border-[var(--border-dark)] font-semibold">
              {filas[0]?.fecha !== undefined && <td className="px-3 py-2" />}
              <td className="px-3 py-2">TOTAL</td>
              {columnas.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{cantidad(totales[c])}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
