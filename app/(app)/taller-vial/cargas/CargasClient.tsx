"use client";

import { useState } from "react";
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

export default function CargasClient({
  mes, equipos, cargas, puedeEditar,
}: {
  mes: string;
  equipos: EquipoTallerVial[];
  cargas: CargaFila[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const irA = (m: string) => router.push(`/taller-vial/cargas?mes=${m}`);

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);
  const [equipoId, setEquipoId] = useState(equipos[0]?.id ?? "");
  const [fecha, setFecha] = useState(hoy);
  const [litros, setLitros] = useState("");
  const [lectura, setLectura] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const litrosTotal = cargas.reduce((s, c) => s + c.litros, 0);
  const sinEquipo = cargas.filter((c) => c.equipo_id === null);

  async function cargar() {
    const equipo = equipos.find((e) => e.id === equipoId);
    if (!equipo) {
      setError("Elegí un equipo");
      return;
    }
    const litrosNum = Number(litros.replace(",", "."));
    if (!isFinite(litrosNum) || litrosNum <= 0) {
      setError("Los litros tienen que ser un número mayor a cero");
      return;
    }
    const lecturaNum = lectura.trim() === "" ? null : Number(lectura.replace(",", "."));
    if (lecturaNum !== null && (!isFinite(lecturaNum) || lecturaNum < 0)) {
      setError("La lectura tiene que ser un número");
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/taller-vial/cargas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipo_id: equipo.id,
          equipo_raw: `${equipo.code} - ${equipo.name}`,
          fecha,
          litros: litrosNum,
          lectura: lecturaNum,
          observaciones: observaciones.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      setLitros("");
      setLectura("");
      setObservaciones("");
      if (!fecha.startsWith(mes)) irA(fecha.slice(0, 7));
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    if (!confirm("¿Borrar esta carga?")) return;
    const res = await fetch(`/api/taller-vial/cargas?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "No se pudo borrar");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Cargas de combustible</h1>
      </div>

      {puedeEditar && (
        <section className="card mt-4 p-4">
          <h2 className="section-title">Cargar combustible</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
            <select className="input sm:col-span-2" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
              {equipos.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.code} - {eq.name}</option>
              ))}
            </select>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <input
              className="input" inputMode="decimal" placeholder="Litros"
              value={litros} onChange={(e) => setLitros(e.target.value)}
            />
            <input
              className="input" inputMode="decimal"
              placeholder={`Horómetro/km (${ETIQUETA_UNIDAD[unidadDeUso(equipos.find((e) => e.id === equipoId)?.code ?? "")]}, opcional)`}
              value={lectura} onChange={(e) => setLectura(e.target.value)}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="input flex-1" placeholder="Observaciones (opcional)"
              value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
            />
            <button className="btn-primary shrink-0" disabled={guardando} onClick={cargar}>Cargar</button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>
      )}

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
                {puedeEditar && <th></th>}
              </tr>
            </thead>
            <tbody>
              {cargas.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 8 : 7} className="py-8 text-center text-slate-400">Sin cargas este mes.</td></tr>
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
                      {puedeEditar && (
                        <td>
                          <button className="text-xs text-slate-400 underline hover:text-red-600" onClick={() => borrar(c.id)}>Borrar</button>
                        </td>
                      )}
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
