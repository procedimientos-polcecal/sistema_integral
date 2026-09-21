"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { costoDeRegistro, resumenPorYacimiento, ETIQUETA_TIPO_RECURSO, ETIQUETA_TIPO_CAMION } from "@/lib/cantera/destape";
import type { DestapeDB, TarifaAcarreoDB } from "@/lib/cantera/types";

/** Colores del módulo — mismos que las tarjetas KPI, reusados en las badges de "Recurso" para que el color siga significando lo mismo en toda la pantalla. */
const COLOR_RECURSO: Record<"operario_propio" | "fletero_externo", { fg: string; bg: string }> = {
  operario_propio: { fg: "#C2410C", bg: "#FFF1E9" },
  fletero_externo: { fg: "#0891B2", bg: "#E6F7FA" },
};

const money = (v: number) => `$ ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(v)}`;
const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

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

function paraDespeje(
  r: DestapeDB,
  codigoPorEquipoId: Record<string, string>,
  valorHoraPorOperarioId: Record<string, number>
) {
  return {
    fecha: r.fecha,
    tipoRecurso: r.tipo_recurso as "operario_propio" | "fletero_externo",
    equipoCodigo: r.equipo_id ? (codigoPorEquipoId[r.equipo_id] ?? null) : null,
    operarioValorHora: r.operario_id ? (valorHoraPorOperarioId[r.operario_id] ?? null) : null,
    fleteroId: r.fletero_id,
    tipoCamion: r.tipo_camion as "camion_grande" | "camion_chico" | null,
    horas: r.horas,
    viajes: r.viajes,
  };
}

export default function DestapeClient({
  mes, registros, tarifasAcarreo, toneladasPromedioPorFletero, costoHoraPorEquipo, codigoPorEquipoId, valorHoraPorOperarioId, horasDestapeAcarreo, puedeEditar, esAdmin,
}: {
  mes: string;
  registros: DestapeDB[];
  /** La tarifa "horas_destape" sale de acá — lib/cantera/acarreo.ts la multiplica ×2 si el camión es grande. */
  tarifasAcarreo: TarifaAcarreoDB[];
  /** Promedio de toneladas por viaje de cada fletero, medido sobre su historial real de Acarreo — reemplaza a la capacidad que se cargaba a mano. */
  toneladasPromedioPorFletero: Record<string, number>;
  /** $/h de cada equipo este mes, ya calculado (Odoo + combustible / horas de uso) — lib/cantera/costoMaquinaOdoo.ts. */
  costoHoraPorEquipo: Record<string, number>;
  codigoPorEquipoId: Record<string, string>;
  /** `empleados.valor_hora_normal` de cada operario — la mano de obra propia vale lo que cobra ESE operario. */
  valorHoraPorOperarioId: Record<string, number>;
  /** "horas_destape" que ya están cargadas en Acarreo, por fletero — sólo para cruzar, no se suma al costo de acá. */
  horasDestapeAcarreo: { fletero: string; horas: number; fecha: string }[];
  puedeEditar: boolean;
  esAdmin: boolean;
}) {
  const router = useRouter();
  const irA = (m: string) => router.push(`/cantera/destape?mes=${m}`);

  const registrosParaResumen = registros.map((r) => ({
    ...paraDespeje(r, codigoPorEquipoId, valorHoraPorOperarioId),
    yacimientoCodigo: r.yacimiento_codigo,
  }));
  const resumen = resumenPorYacimiento(registrosParaResumen, tarifasAcarreo, toneladasPromedioPorFletero, costoHoraPorEquipo);

  const costoTotal = resumen.reduce((s, r) => s + r.costoTotal, 0);
  const horasTotal = resumen.reduce((s, r) => s + r.horasOperario + r.horasFletero, 0);
  const costoMaquina = resumen.reduce((s, r) => s + r.costoMaquina, 0);
  const costoMo = resumen.reduce((s, r) => s + r.costoMo, 0);
  const costoFletero = resumen.reduce((s, r) => s + r.costoFletero, 0);

  const horasDestapeAcarreoPorFletero = (() => {
    const porFletero = new Map<string, { horas: number; dias: Set<string> }>();
    for (const h of horasDestapeAcarreo) {
      const acc = porFletero.get(h.fletero) ?? { horas: 0, dias: new Set<string>() };
      acc.horas += h.horas;
      acc.dias.add(h.fecha);
      porFletero.set(h.fletero, acc);
    }
    return [...porFletero.entries()]
      .map(([fletero, { horas, dias }]) => ({ fletero, horas, dias: dias.size }))
      .sort((a, b) => a.fletero.localeCompare(b.fletero));
  })();

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-header">Destape</h1>
        <div className="flex items-center gap-2">
          {esAdmin && <Link href="/cantera/tarifas-acarreo" className="btn-secondary">Tarifas</Link>}
          {puedeEditar && (
            <Link href="/cantera/destape/cargar" className="btn-primary">Cargar</Link>
          )}
        </div>
      </div>
      <p className="page-subheader">El costo de destapar un frente: horas de máquina propia o de un fletero externo, por yacimiento.</p>

      <div className="card mt-4 flex items-center justify-between p-3">
        <button className="btn-ghost" onClick={() => irA(moverMes(mes, -1))}>← Mes anterior</button>
        <span className="font-semibold text-slate-800">{nombreDeMes(mes)}</span>
        <button className="btn-ghost" onClick={() => irA(moverMes(mes, 1))}>Mes siguiente →</button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4" style={{ borderTop: "3px solid #1E7D34" }}>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#1E7D34" }}>{money(costoTotal)}</div>
          <div className="mt-0.5 text-sm text-slate-500">Costo total del mes</div>
        </div>
        <div className="card p-4" style={{ borderTop: "3px solid #7E22CE" }}>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#7E22CE" }}>{num.format(horasTotal)}</div>
          <div className="mt-0.5 text-sm text-slate-500">Horas totales</div>
        </div>
        <div className="card p-4" style={{ borderTop: "3px solid #0891B2" }}>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#0891B2" }}>{money(costoFletero)}</div>
          <div className="mt-0.5 text-sm text-slate-500">Fletero externo</div>
        </div>
        <div className="card p-4" style={{ borderTop: "3px solid #C2410C" }}>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#C2410C" }}>{money(costoMaquina + costoMo)}</div>
          <div className="mt-0.5 text-sm text-slate-500">Máquina + MO propia</div>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="section-title">Por yacimiento</h2>
        <div className="card mt-2 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Yacimiento</th>
                  <th className="text-right">Hs. operario</th>
                  <th className="text-right">Hs. fletero</th>
                  <th className="text-right">Costo máquina</th>
                  <th className="text-right">Costo MO</th>
                  <th className="text-right">Costo fletero</th>
                  <th className="text-right">Costo total</th>
                </tr>
              </thead>
              <tbody>
                {resumen.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-400">Sin destape cargado este mes.</td></tr>
                ) : (
                  resumen.map((r) => (
                    <tr key={r.yacimientoCodigo}>
                      <td className="font-medium text-slate-800">{r.yacimientoCodigo}</td>
                      <td className="text-right font-mono tabular-nums">{num.format(r.horasOperario)}</td>
                      <td className="text-right font-mono tabular-nums">{num.format(r.horasFletero)}</td>
                      <td className="text-right font-mono tabular-nums">{money(r.costoMaquina)}</td>
                      <td className="text-right font-mono tabular-nums">{money(r.costoMo)}</td>
                      <td className="text-right font-mono tabular-nums">{money(r.costoFletero)}</td>
                      <td className="text-right font-mono tabular-nums font-semibold">{money(r.costoTotal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {horasDestapeAcarreoPorFletero.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title">Horas de destape en Acarreo</h2>
          <div className="card mt-2 p-4">
            <p className="text-sm text-slate-500">
              Ya están cargadas por fletero en Acarreo (tipo &quot;Horas destape&quot;) — es sólo
              referencia para no cargarlas dos veces acá. No suman al costo de este tablero.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {horasDestapeAcarreoPorFletero.map((f) => (
                <div
                  key={f.fletero}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-3.5"
                >
                  <span className="text-sm font-medium text-slate-700">{f.fletero}</span>
                  <span className="font-mono text-sm tabular-nums text-slate-600">{num.format(f.horas)} hs</span>
                  <span className="text-xs text-slate-400">· {f.dias} {f.dias === 1 ? "día" : "días"}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="section-title">Registros del mes</h2>
        <div className="card mt-2 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Yacimiento</th>
                  <th>Recurso</th>
                  <th>Equipo / Vehículo</th>
                  <th className="text-right">Horas</th>
                  <th className="text-right">Viajes · Ton. est.</th>
                  <th className="text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {registros.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-400">Sin registros este mes.</td></tr>
                ) : (
                  [...registros]
                    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
                    .map((r, i) => {
                      const tipoRecurso = r.tipo_recurso as "operario_propio" | "fletero_externo";
                      const costo = costoDeRegistro(
                        paraDespeje(r, codigoPorEquipoId, valorHoraPorOperarioId),
                        tarifasAcarreo,
                        toneladasPromedioPorFletero,
                        costoHoraPorEquipo
                      );
                      return (
                        <tr key={r.id} className={i % 2 === 1 ? "bg-slate-50/60" : undefined}>
                          <td className="whitespace-nowrap">
                            {r.fecha}
                            {r.sheets_pendiente && <span className="ml-1.5 text-amber-600" title={r.sheets_pendiente}>⚠</span>}
                          </td>
                          <td>{r.yacimiento_codigo ?? "—"}{r.frente ? ` (${r.frente})` : ""}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <span
                                className="badge"
                                style={{ color: COLOR_RECURSO[tipoRecurso].fg, background: COLOR_RECURSO[tipoRecurso].bg }}
                              >
                                {ETIQUETA_TIPO_RECURSO[tipoRecurso]}
                              </span>
                              <span>{r.recurso_raw}</span>
                            </div>
                          </td>
                          <td>
                            {r.equipo_o_vehiculo_raw}
                            {r.tipo_camion && <span className="text-xs text-slate-400"> ({ETIQUETA_TIPO_CAMION[r.tipo_camion as "camion_grande" | "camion_chico"]})</span>}
                          </td>
                          <td className="text-right font-mono tabular-nums">{num.format(r.horas)}</td>
                          <td className="text-right font-mono tabular-nums text-slate-500">
                            {r.viajes !== null ? (
                              <>
                                {r.viajes} viajes
                                {costo.toneladasEstimadas !== null && <> · ≈{num.format(costo.toneladasEstimadas)} t</>}
                              </>
                            ) : "—"}
                          </td>
                          <td className="text-right font-mono tabular-nums font-semibold" style={{ color: "#1E7D34" }}>
                            {money(costo.costoTotal)}
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
