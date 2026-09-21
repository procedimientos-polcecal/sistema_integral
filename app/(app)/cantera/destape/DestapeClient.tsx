"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { costoDeRegistro, resumenPorYacimiento, ETIQUETA_TIPO_RECURSO, ETIQUETA_TIPO_CAMION } from "@/lib/cantera/destape";
import type { CapacidadFleteroDB, DestapeDB, TarifaDestapeDB } from "@/lib/cantera/types";

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

function paraDespeje(r: DestapeDB, codigoPorEquipoId: Record<string, string>) {
  return {
    fecha: r.fecha,
    tipoRecurso: r.tipo_recurso as "operario_propio" | "fletero_externo",
    equipoCodigo: r.equipo_id ? (codigoPorEquipoId[r.equipo_id] ?? null) : null,
    fleteroId: r.fletero_id,
    tipoCamion: r.tipo_camion as "camion_grande" | "camion_chico" | null,
    horas: r.horas,
    viajes: r.viajes,
  };
}

export default function DestapeClient({
  mes, registros, tarifas, capacidades, codigoPorEquipoId, puedeEditar, esAdmin,
}: {
  mes: string;
  registros: DestapeDB[];
  tarifas: TarifaDestapeDB[];
  capacidades: CapacidadFleteroDB[];
  codigoPorEquipoId: Record<string, string>;
  puedeEditar: boolean;
  esAdmin: boolean;
}) {
  const router = useRouter();
  const irA = (m: string) => router.push(`/cantera/destape?mes=${m}`);

  const registrosParaResumen = registros.map((r) => ({ ...paraDespeje(r, codigoPorEquipoId), yacimientoCodigo: r.yacimiento_codigo }));
  const capacidadesPlanas = capacidades.map((c) => ({ fleteroId: c.fletero_id, tipoCamion: c.tipo_camion, toneladasPorViaje: c.toneladas_por_viaje }));
  const tarifasPlanas = tarifas.map((t) => ({ categoria: t.categoria as "maquina_propia" | "mo_propia" | "fletero_externo", clave: t.clave, desde: t.desde, hasta: t.hasta, tarifa: t.tarifa }));
  const resumen = resumenPorYacimiento(registrosParaResumen, tarifasPlanas, capacidadesPlanas);

  const costoTotal = resumen.reduce((s, r) => s + r.costoTotal, 0);
  const horasTotal = resumen.reduce((s, r) => s + r.horasOperario + r.horasFletero, 0);
  const costoMaquina = resumen.reduce((s, r) => s + r.costoMaquina, 0);
  const costoMo = resumen.reduce((s, r) => s + r.costoMo, 0);
  const costoFletero = resumen.reduce((s, r) => s + r.costoFletero, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-header">Destape</h1>
        <div className="flex items-center gap-2">
          {esAdmin && (
            <>
              <Link href="/cantera/capacidades-fletero" className="btn-secondary">Capacidades</Link>
              <Link href="/cantera/tarifas-destape" className="btn-secondary">Tarifas</Link>
            </>
          )}
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
                  <th className="text-right">Viajes</th>
                  <th className="text-right">Toneladas est.</th>
                  <th className="text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {registros.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-slate-400">Sin registros este mes.</td></tr>
                ) : (
                  [...registros]
                    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
                    .map((r) => {
                      const costo = costoDeRegistro(paraDespeje(r, codigoPorEquipoId), tarifasPlanas, capacidadesPlanas);
                      return (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap">
                            {r.fecha}
                            {r.sheets_pendiente && <span className="ml-1.5 text-amber-600" title={r.sheets_pendiente}>⚠</span>}
                          </td>
                          <td>{r.yacimiento_codigo ?? "—"}{r.frente ? ` (${r.frente})` : ""}</td>
                          <td>
                            <span className="text-xs text-slate-400">{ETIQUETA_TIPO_RECURSO[r.tipo_recurso as "operario_propio" | "fletero_externo"]}</span>
                            <br />{r.recurso_raw}
                          </td>
                          <td>
                            {r.equipo_o_vehiculo_raw}
                            {r.tipo_camion && <span className="text-xs text-slate-400"> ({ETIQUETA_TIPO_CAMION[r.tipo_camion as "camion_grande" | "camion_chico"]})</span>}
                          </td>
                          <td className="text-right font-mono tabular-nums">{num.format(r.horas)}</td>
                          <td className="text-right font-mono tabular-nums">{r.viajes ?? "—"}</td>
                          <td className="text-right font-mono tabular-nums">{costo.toneladasEstimadas !== null ? num.format(costo.toneladasEstimadas) : "—"}</td>
                          <td className="text-right font-mono tabular-nums">{money(costo.costoTotal)}</td>
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
