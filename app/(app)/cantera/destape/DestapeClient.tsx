"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import { costoDeRegistro, resumenPorYacimiento, ETIQUETA_TIPO_RECURSO, ETIQUETA_TIPO_CAMION } from "@/lib/cantera/destape";
import type { DestapeDB, TarifaAcarreoDB } from "@/lib/cantera/types";

/** Colores del módulo — mismos que las tarjetas KPI, reusados en las badges de "Recurso" y en el calendario para que el color siga significando lo mismo en toda la pantalla. */
const COLOR_RECURSO: Record<"operario_propio" | "fletero_externo", { fg: string; bg: string; border: string }> = {
  operario_propio: { fg: "#C2410C", bg: "#FFF1E9", border: "#FED7AA" },
  fletero_externo: { fg: "#0891B2", bg: "#E6F7FA", border: "#A5E4EE" },
};

const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

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

const NOMBRE_DIA = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Calendario del mes — reemplaza a la tabla plana de "Registros del mes".
 * Cuando un día tiene varios recursos cargados (máquina + un par de
 * fleteros, por ejemplo) la tabla vieja repetía la fecha 3 o 4 veces
 * seguidas; acá un día es una sola celda y el detalle de ESE día se ve
 * abajo, elegido — mismo patrón que ya usa el calendario de
 * `/trituracion/partes`.
 */
function CalendarioDestape({
  mes, porFecha, diaSeleccionado, onElegir,
}: {
  mes: string;
  porFecha: Map<string, DestapeDB[]>;
  diaSeleccionado: string | null;
  onElegir: (fecha: string) => void;
}) {
  const [anio, mesNum] = mes.split("-").map(Number);
  const diasEnMes = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(anio, mesNum - 1, 1)).getUTCDay() + 6) % 7;
  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400">
        {DIAS_SEMANA.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => <div key={`o${i}`} />)}
        {Array.from({ length: diasEnMes }, (_, i) => i + 1).map((dia) => {
          const fecha = `${mes}-${String(dia).padStart(2, "0")}`;
          const registrosDelDia = porFecha.get(fecha) ?? [];
          const seleccionado = fecha === diaSeleccionado;
          const esHoy = fecha === hoy;
          const tieneOperario = registrosDelDia.some((r) => r.tipo_recurso === "operario_propio");
          const tieneFletero = registrosDelDia.some((r) => r.tipo_recurso === "fletero_externo");

          let estilo: { background?: string; borderColor?: string; color?: string; boxShadow?: string } | undefined;
          if (tieneOperario && tieneFletero) {
            estilo = {
              background: `linear-gradient(135deg, ${COLOR_RECURSO.operario_propio.bg} 50%, ${COLOR_RECURSO.fletero_externo.bg} 50%)`,
              borderColor: "#CBD5E1", color: "#334155",
            };
          } else if (tieneOperario) {
            estilo = { background: COLOR_RECURSO.operario_propio.bg, borderColor: COLOR_RECURSO.operario_propio.border, color: COLOR_RECURSO.operario_propio.fg };
          } else if (tieneFletero) {
            estilo = { background: COLOR_RECURSO.fletero_externo.bg, borderColor: COLOR_RECURSO.fletero_externo.border, color: COLOR_RECURSO.fletero_externo.fg };
          }
          if (seleccionado) estilo = { ...estilo, boxShadow: "0 0 0 2px #1E7D34" };

          const tooltip = registrosDelDia.length === 0
            ? "Sin registros"
            : registrosDelDia.map((r) => `${ETIQUETA_TIPO_RECURSO[r.tipo_recurso as "operario_propio" | "fletero_externo"]}: ${r.recurso_raw}`).join(" | ");

          return (
            <button
              key={fecha}
              type="button"
              onClick={() => onElegir(fecha)}
              title={tooltip}
              style={estilo}
              className={`relative aspect-square rounded-md border text-xs font-medium transition-colors ${
                estilo?.background ? "hover:brightness-95" : "border-dashed border-slate-200 text-slate-400 hover:border-slate-300"
              } ${seleccionado ? "ring-2 ring-offset-1" : ""} ${esHoy && !seleccionado ? "font-bold" : ""}`}
            >
              {dia}
              {registrosDelDia.length > 1 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-700 text-[9px] font-bold text-white">
                  {registrosDelDia.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
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

  const registrosPorFecha = new Map<string, DestapeDB[]>();
  for (const r of registros) {
    const lista = registrosPorFecha.get(r.fecha) ?? [];
    lista.push(r);
    registrosPorFecha.set(r.fecha, lista);
  }
  // Por defecto, el día con actividad más reciente del mes — así se ve algo apenas se entra, sin tener que elegir.
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(() => {
    const fechas = [...registrosPorFecha.keys()].sort();
    return fechas.length > 0 ? fechas[fechas.length - 1] : null;
  });
  const registrosDelDiaElegido = diaSeleccionado ? (registrosPorFecha.get(diaSeleccionado) ?? []) : [];
  const costoDelDiaElegido = registrosDelDiaElegido.reduce(
    (s, r) => s + costoDeRegistro(paraDespeje(r, codigoPorEquipoId, valorHoraPorOperarioId), tarifasAcarreo, toneladasPromedioPorFletero, costoHoraPorEquipo).costoTotal,
    0
  );

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
        <KpiCard color="#1E7D34" value={money(costoTotal)} label="Costo total del mes" />
        <KpiCard color="#7E22CE" value={num.format(horasTotal)} label="Horas totales" />
        <KpiCard color="#0891B2" value={money(costoFletero)} label="Fletero externo" />
        <KpiCard color="#C2410C" value={money(costoMaquina + costoMo)} label="Máquina + MO propia" />
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
        <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="card p-4 lg:col-span-2">
            <CalendarioDestape mes={mes} porFecha={registrosPorFecha} diaSeleccionado={diaSeleccionado} onElegir={setDiaSeleccionado} />
            <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_RECURSO.operario_propio.bg, border: `1px solid ${COLOR_RECURSO.operario_propio.border}` }} />
                Operario propio
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_RECURSO.fletero_externo.bg, border: `1px solid ${COLOR_RECURSO.fletero_externo.border}` }} />
                Fletero externo
              </span>
            </div>
          </div>

          <div className="card overflow-hidden lg:col-span-3">
            <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">
                {diaSeleccionado ? NOMBRE_DIA.format(new Date(`${diaSeleccionado}T00:00:00Z`)) : "Elegí un día"}
              </span>
              {registrosDelDiaElegido.length > 0 && (
                <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: "#1E7D34" }}>{money(costoDelDiaElegido)}</span>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {registrosDelDiaElegido.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  {diaSeleccionado ? "Sin registros este día." : "Elegí un día del calendario para ver el detalle."}
                </p>
              ) : (
                registrosDelDiaElegido.map((r) => {
                  const tipoRecurso = r.tipo_recurso as "operario_propio" | "fletero_externo";
                  const costo = costoDeRegistro(
                    paraDespeje(r, codigoPorEquipoId, valorHoraPorOperarioId),
                    tarifasAcarreo,
                    toneladasPromedioPorFletero,
                    costoHoraPorEquipo
                  );
                  return (
                    <div key={r.id} className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="badge"
                            style={{ color: COLOR_RECURSO[tipoRecurso].fg, background: COLOR_RECURSO[tipoRecurso].bg }}
                          >
                            {ETIQUETA_TIPO_RECURSO[tipoRecurso]}
                          </span>
                          <span className="text-sm font-medium text-slate-800">{r.recurso_raw}</span>
                          {r.sheets_pendiente && <span className="text-amber-600" title={r.sheets_pendiente}>⚠</span>}
                        </div>
                        <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: "#1E7D34" }}>{money(costo.costoTotal)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>{r.yacimiento_codigo ?? "Sin yacimiento"}{r.frente ? ` (${r.frente})` : ""}</span>
                        <span>
                          {r.equipo_o_vehiculo_raw}
                          {r.tipo_camion && ` (${ETIQUETA_TIPO_CAMION[r.tipo_camion as "camion_grande" | "camion_chico"]})`}
                        </span>
                        <span className="font-mono tabular-nums">{num.format(r.horas)} hs</span>
                        {r.viajes !== null && (
                          <span className="font-mono tabular-nums">
                            {r.viajes} viajes{costo.toneladasEstimadas !== null && <> · ≈{num.format(costo.toneladasEstimadas)} t</>}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
