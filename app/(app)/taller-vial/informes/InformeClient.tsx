"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ETIQUETA_UNIDAD, unidadDeUso } from "@/lib/tallerVial/equipos";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";
import type { FilaInformeConsumo, FilaInformeDisponibilidad, LecturaDeDisponibilidad } from "@/lib/tallerVial/informe";

const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

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

const ESTILO_DISPONIBILIDAD: Record<LecturaDeDisponibilidad, string> = {
  CRITICO: "text-red-600",
  ACEPTABLE: "text-amber-700",
  BUENO: "text-emerald-700",
};
const ICONO_DISPONIBILIDAD: Record<LecturaDeDisponibilidad, string> = {
  CRITICO: "🔴",
  ACEPTABLE: "🟡",
  BUENO: "🟢",
};

export default function InformeClient({
  mes, equipos, informeConsumo, informeDisponibilidad,
}: {
  mes: string;
  equipos: EquipoTallerVial[];
  informeConsumo: FilaInformeConsumo[];
  informeDisponibilidad: FilaInformeDisponibilidad[];
}) {
  const router = useRouter();
  const irA = (m: string) => router.push(`/taller-vial/informes?mes=${m}`);
  const porId = new Map(equipos.map((e) => [e.id, e]));

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Informe mensual</h1>
      </div>

      <div className="card mt-4 flex items-center justify-between p-3">
        <button className="btn-ghost" onClick={() => irA(moverMes(mes, -1))}>← Mes anterior</button>
        <span className="font-semibold text-slate-800">{nombreDeMes(mes)}</span>
        <button className="btn-ghost" onClick={() => irA(moverMes(mes, 1))}>Mes siguiente →</button>
      </div>

      <section className="card mt-4 p-4">
        <h2 className="font-semibold text-slate-900">Resumen de consumo por equipo</h2>
        <p className="mt-1 text-xs text-slate-500">
          La referencia histórica es el consumo promedio de los 6 meses anteriores, calculado — no es la referencia manual de la planilla real, que el SdG no tiene cargada.
        </p>
        {informeConsumo.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Sin cargas de combustible este mes.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th className="text-right">Cargas</th>
                  <th className="text-right">Litros</th>
                  <th className="text-right">Consumo del mes</th>
                  <th className="text-right">Ref. histórica</th>
                  <th className="text-right">Desvío</th>
                </tr>
              </thead>
              <tbody>
                {informeConsumo
                  .map((f) => ({ ...f, equipo: porId.get(f.equipoId) }))
                  .filter((f) => f.equipo)
                  .sort((a, b) => b.litrosTotal - a.litrosTotal)
                  .map((f) => {
                    const unidad = unidadDeUso(f.equipo!.code);
                    return (
                      <tr key={f.equipoId}>
                        <td className="font-medium text-slate-800">{f.equipo!.code} - {f.equipo!.name}</td>
                        <td className="text-right">{f.cargas}</td>
                        <td className="text-right font-mono tabular-nums">{num0.format(f.litrosTotal)}</td>
                        <td className="text-right font-mono tabular-nums">
                          {f.consumoDelMes !== null ? `${num1.format(f.consumoDelMes)} L/${ETIQUETA_UNIDAD[unidad]}` : "—"}
                        </td>
                        <td className="text-right font-mono tabular-nums text-slate-500">
                          {f.referenciaHistorica !== null ? `${num1.format(f.referenciaHistorica)} L/${ETIQUETA_UNIDAD[unidad]}` : "—"}
                        </td>
                        <td className={`text-right font-mono tabular-nums ${f.desvio !== null && Math.abs(f.desvio) > 2 ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                          {f.desvio !== null ? `${f.desvio >= 0 ? "+" : ""}${num1.format(f.desvio)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-4 p-4">
        <h2 className="font-semibold text-slate-900">Disponibilidad</h2>
        <p className="mt-1 text-xs text-slate-500">
          Días operativo sobre días con estado cargado — no es la cuenta de horas de la planilla real (depende del régimen de turnos, que el SdG no tiene). 🔴 &lt;70% · 🟡 70-84% · 🟢 ≥85%.
        </p>
        {informeDisponibilidad.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Sin estados cargados este mes.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th className="text-right">Días operativo</th>
                  <th className="text-right">Días con dato</th>
                  <th className="text-right">Disponibilidad</th>
                </tr>
              </thead>
              <tbody>
                {informeDisponibilidad
                  .map((f) => ({ ...f, equipo: porId.get(f.equipoId) }))
                  .filter((f) => f.equipo)
                  .sort((a, b) => (a.disponibilidadPct ?? 0) - (b.disponibilidadPct ?? 0))
                  .map((f) => (
                    <tr key={f.equipoId}>
                      <td className="font-medium text-slate-800">{f.equipo!.code} - {f.equipo!.name}</td>
                      <td className="text-right font-mono tabular-nums">{f.diasOperativo}</td>
                      <td className="text-right font-mono tabular-nums">{f.diasRegistrados}</td>
                      <td className={`text-right font-mono tabular-nums ${f.lectura ? ESTILO_DISPONIBILIDAD[f.lectura] : "text-slate-400"}`}>
                        {f.disponibilidadPct !== null ? (
                          <>{f.lectura && ICONO_DISPONIBILIDAD[f.lectura]} {num1.format(f.disponibilidadPct)}%</>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
