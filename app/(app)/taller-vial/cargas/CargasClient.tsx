"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ETIQUETA_UNIDAD, unidadDeUso } from "@/lib/tallerVial/equipos";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";

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

interface CargaFila {
  id: string;
  equipo_id: string | null;
  equipo_raw: string;
  fecha: string;
  litros: number;
  lectura: number | null;
  observaciones: string | null;
  trabajado: number | null;
  consumoPorUnidad: number | null;
}

/**
 * Sólo lectura: las cargas se siguen tipeando en la planilla real, esto es un
 * espejo (`lib/tallerVial/importar.ts`, cada 20-30 min por
 * `/api/cron/taller-vial-sync`). Nada de esto tiene un formulario de carga a
 * propósito.
 */
export default function CargasClient({
  mes, equipos, cargas,
}: {
  mes: string;
  equipos: EquipoTallerVial[];
  cargas: CargaFila[];
}) {
  const router = useRouter();
  const irA = (m: string) => router.push(`/taller-vial/cargas?mes=${m}`);

  const litrosTotal = cargas.reduce((s, c) => s + c.litros, 0);
  const sinEquipo = cargas.filter((c) => c.equipo_id === null);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Cargas de combustible</h1>
        <p className="page-subheader">Se cargan en la planilla real; acá sólo se ven.</p>
      </div>

      {/* ── Navegador de mes ── */}
      <div className="card mt-4 flex items-center justify-between p-3">
        <button className="btn-ghost" onClick={() => irA(moverMes(mes, -1))}>← Mes anterior</button>
        <span className="font-semibold text-slate-800">{nombreDeMes(mes)}</span>
        <button className="btn-ghost" onClick={() => irA(moverMes(mes, 1))}>Mes siguiente →</button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-2xl font-bold tabular-nums text-[#0891B2]">{num0.format(litrosTotal)} L</div>
          <div className="mt-0.5 text-sm text-slate-500">Total del mes</div>
        </div>
        <div className="card p-4">
          <div className="text-2xl font-bold tabular-nums text-slate-700">{cargas.length}</div>
          <div className="mt-0.5 text-sm text-slate-500">Cargas</div>
        </div>
        {sinEquipo.length > 0 && (
          <div className="card p-4" style={{ borderTop: "3px solid #B45309" }}>
            <div className="text-2xl font-bold tabular-nums text-amber-700">{sinEquipo.length}</div>
            <div className="mt-0.5 text-sm text-slate-500">Sin equipo reconocido</div>
          </div>
        )}
      </div>

      <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Equipo</th>
                <th className="text-right">Litros</th>
                <th className="text-right">Lectura</th>
                <th className="text-right">Trabajado</th>
                <th className="text-right">Consumo</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {cargas.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">Sin cargas este mes.</td></tr>
              ) : (
                cargas.map((c) => {
                  const equipo = equipos.find((e) => e.id === c.equipo_id);
                  const unidad = equipo ? unidadDeUso(equipo.code) : null;
                  return (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap">{c.fecha}</td>
                      <td className={equipo ? "text-slate-800" : "text-amber-700"}>{c.equipo_raw}</td>
                      <td className="text-right font-mono tabular-nums">{num0.format(c.litros)}</td>
                      <td className="text-right font-mono tabular-nums">{c.lectura !== null ? num0.format(c.lectura) : "—"}</td>
                      <td className="text-right font-mono tabular-nums">
                        {c.trabajado !== null && unidad ? `${num1.format(c.trabajado)} ${ETIQUETA_UNIDAD[unidad]}` : "—"}
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        {c.consumoPorUnidad !== null && unidad ? `${num1.format(c.consumoPorUnidad)} L/${ETIQUETA_UNIDAD[unidad]}` : "—"}
                      </td>
                      <td className="text-slate-500">{c.observaciones ?? ""}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
