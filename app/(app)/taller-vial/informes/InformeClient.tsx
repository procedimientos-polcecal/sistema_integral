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

const ICONO_DISPONIBILIDAD: Record<LecturaDeDisponibilidad, string> = {
  CRITICO: "🔴",
  ACEPTABLE: "🟡",
  BUENO: "🟢",
};

// Mismos dos colores que usa el informe de Cantera (`lib/cantera` /
// `app/(app)/cantera/informes/InformeClient.tsx`) para que los dos informes
// del sistema se lean igual: verde para lo que se calcula "bien" (consumo),
// ámbar para lo que necesita mirarse (disponibilidad).
const VERDE = "#1E7D34";
const VERDE_CLARO = "#F0F8F5";
const AMBAR = "#E8A020";
const AMBAR_CLARO = "#FFF7ED";

/** El encabezado de una tabla, con el color verde o ámbar de la planilla — igual que en el informe de Cantera. */
function Encabezado({ color, columnas }: { color: string; columnas: string[] }) {
  return (
    <tr style={{ backgroundColor: color }}>
      {columnas.map((c) => (
        <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-white">{c}</th>
      ))}
    </tr>
  );
}

/** Una fila de datos con cebra del color de su sección. */
function FilaCebra({ i, claro, children }: { i: number; claro: string; children: React.ReactNode }) {
  return <tr style={{ backgroundColor: i % 2 === 1 ? claro : undefined }}>{children}</tr>;
}

function FilaTotal({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <tr style={{ backgroundColor: color }} className="font-semibold text-white">
      {children}
    </tr>
  );
}

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

  const consumo = informeConsumo
    .map((f) => ({ ...f, equipo: porId.get(f.equipoId) }))
    .filter((f): f is typeof f & { equipo: EquipoTallerVial } => Boolean(f.equipo))
    .sort((a, b) => b.litrosTotal - a.litrosTotal);
  const disponibilidad = informeDisponibilidad
    .map((f) => ({ ...f, equipo: porId.get(f.equipoId) }))
    .filter((f): f is typeof f & { equipo: EquipoTallerVial } => Boolean(f.equipo))
    .sort((a, b) => (a.disponibilidadPct ?? 0) - (b.disponibilidadPct ?? 0));

  const totalCargas = consumo.reduce((s, f) => s + f.cargas, 0);
  const totalLitros = consumo.reduce((s, f) => s + f.litrosTotal, 0);
  const pctsValidos = disponibilidad.map((f) => f.disponibilidadPct).filter((p): p is number => p !== null);
  const promedioDisponibilidad = pctsValidos.length > 0 ? pctsValidos.reduce((s, p) => s + p, 0) / pctsValidos.length : null;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Informe mensual</h1>
      </div>

      <div className="card mt-4 flex flex-wrap items-center justify-between gap-2 p-3">
        <button className="btn-ghost" onClick={() => irA(moverMes(mes, -1))}>← Mes anterior</button>
        <span className="font-semibold text-slate-800">{nombreDeMes(mes)}</span>
        <div className="flex items-center gap-2">
          <a
            href={`/api/taller-vial/informes/export?mes=${mes}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Exportar a Excel
          </a>
          <button className="btn-ghost" onClick={() => irA(moverMes(mes, 1))}>Mes siguiente →</button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden card">
        {/* ── Título, como el de Cantera ── */}
        <div style={{ backgroundColor: VERDE }} className="px-4 py-2 text-sm font-semibold text-white">
          INFORME DE EQUIPOS MÓVILES — {nombreDeMes(mes).toUpperCase()}
        </div>
        <div style={{ backgroundColor: VERDE_CLARO }} className="px-4 py-1.5 text-xs text-slate-500">
          Generado: {new Date().toLocaleString("es-AR")} · La referencia histórica y la disponibilidad se calculan distinto de la planilla real — ver las notas de cada tabla.
        </div>

        <div className="p-4">
          {/* ── Resumen de consumo por equipo ── */}
          <h2 className="text-sm font-semibold text-slate-700">▸ Resumen de consumo por equipo</h2>
          <p className="mt-1 text-xs text-slate-500">
            La referencia histórica es el consumo promedio de los 6 meses anteriores, calculado — no es la referencia manual de la planilla real, que el SdG no tiene cargada.
          </p>
          <div className="mt-2 overflow-x-auto card">
            <table className="w-full text-sm">
              <thead>
                <Encabezado color={VERDE} columnas={["Equipo", "Cargas", "Litros", "Consumo del mes", "Ref. histórica", "Desvío"]} />
              </thead>
              <tbody>
                {consumo.map((f, i) => {
                  const unidad = unidadDeUso(f.equipo.code);
                  return (
                    <FilaCebra key={f.equipoId} i={i} claro={VERDE_CLARO}>
                      <td className="px-3 py-2 font-medium text-slate-800">{f.equipo.code} - {f.equipo.name}</td>
                      <td className="px-3 py-2">{f.cargas}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{num0.format(f.litrosTotal)}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {f.consumoDelMes !== null ? `${num1.format(f.consumoDelMes)} L/${ETIQUETA_UNIDAD[unidad]}` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-500">
                        {f.referenciaHistorica !== null ? `${num1.format(f.referenciaHistorica)} L/${ETIQUETA_UNIDAD[unidad]}` : "—"}
                      </td>
                      <td className={`px-3 py-2 font-mono tabular-nums ${f.desvio !== null && Math.abs(f.desvio) > 2 ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                        {f.desvio !== null ? `${f.desvio >= 0 ? "+" : ""}${num1.format(f.desvio)}` : "—"}
                      </td>
                    </FilaCebra>
                  );
                })}
                {consumo.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin cargas de combustible este mes.</td></tr>
                )}
              </tbody>
              {consumo.length > 0 && (
                <tfoot>
                  <FilaTotal color={VERDE}>
                    <td className="px-3 py-2">TOTALES</td>
                    <td className="px-3 py-2">{totalCargas}</td>
                    <td className="px-3 py-2">{num0.format(totalLitros)}</td>
                    <td className="px-3 py-2" colSpan={3}></td>
                  </FilaTotal>
                </tfoot>
              )}
            </table>
          </div>

          {/* ── Disponibilidad ── */}
          <h2 className="mt-6 text-sm font-semibold text-slate-700">▸ Disponibilidad</h2>
          <p className="mt-1 text-xs text-slate-500">
            Días operativo sobre días con estado cargado — no es la cuenta de horas de la planilla real (depende del régimen de turnos, que el SdG no tiene). 🔴 &lt;70% · 🟡 70-84% · 🟢 ≥85%.
          </p>
          <div className="mt-2 overflow-x-auto card">
            <table className="w-full text-sm">
              <thead>
                <Encabezado color={AMBAR} columnas={["Equipo", "Días operativo", "Días con dato", "Disponibilidad"]} />
              </thead>
              <tbody>
                {disponibilidad.map((f, i) => (
                  <FilaCebra key={f.equipoId} i={i} claro={AMBAR_CLARO}>
                    <td className="px-3 py-2 font-medium text-slate-800">{f.equipo.code} - {f.equipo.name}</td>
                    <td className="px-3 py-2">{f.diasOperativo}</td>
                    <td className="px-3 py-2">{f.diasRegistrados}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {f.disponibilidadPct !== null ? (
                        <>{f.lectura && ICONO_DISPONIBILIDAD[f.lectura]} {num1.format(f.disponibilidadPct)}%</>
                      ) : (
                        "—"
                      )}
                    </td>
                  </FilaCebra>
                ))}
                {disponibilidad.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Sin estados cargados este mes.</td></tr>
                )}
              </tbody>
              {promedioDisponibilidad !== null && (
                <tfoot>
                  <FilaTotal color={AMBAR}>
                    <td className="px-3 py-2" colSpan={3}>PROMEDIO FLOTA</td>
                    <td className="px-3 py-2">{num1.format(promedioDisponibilidad)}%</td>
                  </FilaTotal>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
