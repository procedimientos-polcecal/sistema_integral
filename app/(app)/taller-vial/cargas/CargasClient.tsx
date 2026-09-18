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
  sheets_pendiente?: string | null;
  trabajado: number | null;
  consumoPorUnidad: number | null;
}

/**
 * Pivote del 18/09/2026: la carga vuelve a hacerse desde acá (antes era un
 * espejo de sólo lectura de la planilla real, sincronizado por
 * `lib/tallerVial/importar.ts`). Al guardar, `/api/taller-vial/cargas`
 * además la exporta hacia "DATOS" de esa misma planilla — ver
 * `lib/tallerVial/espejo.ts` — para que quien no entra al sistema la siga
 * viendo al día.
 */
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
  const [aviso, setAviso] = useState<string | null>(null);

  async function cargar() {
    const litrosNum = Number(litros.replace(",", "."));
    if (!equipoId) { setError("Elegí un equipo"); return; }
    if (!isFinite(litrosNum) || litrosNum <= 0) { setError("Los litros tienen que ser un número mayor a cero"); return; }

    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch("/api/taller-vial/cargas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipo_id: equipoId,
          fecha,
          litros: litrosNum,
          lectura: lectura.trim() === "" ? null : Number(lectura.replace(",", ".")),
          observaciones: observaciones.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      if (json.aviso) setAviso(json.aviso.mensaje);

      setLitros("");
      setLectura("");
      setObservaciones("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const litrosTotal = cargas.reduce((s, c) => s + c.litros, 0);
  const sinEquipo = cargas.filter((c) => c.equipo_id === null);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-header">Cargas de combustible</h1>
          <p className="page-subheader">Queda exportada a la planilla real al guardar.</p>
        </div>
        <Link href="/taller-vial/estados" className="btn-primary">Cambiar estado de un equipo</Link>
      </div>

      {puedeEditar && (
        <section className="card mt-4 p-4">
          <h2 className="section-title">Cargar combustible</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
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
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              className="input" inputMode="decimal" placeholder="Horómetro o km (opcional)"
              value={lectura} onChange={(e) => setLectura(e.target.value)}
            />
            <input
              className="input sm:col-span-2" placeholder="Observaciones (opcional)"
              value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button className="btn-primary" disabled={guardando} onClick={cargar}>Cargar</button>
          </div>
          {aviso && <p className="mt-2 text-sm text-amber-700">{aviso}</p>}
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

      <section className="mt-6">
        <h2 className="section-title">Cargas del mes</h2>
        <div className="card mt-2 overflow-hidden">
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
                cargas.map((c, i) => {
                  const equipo = equipos.find((e) => e.id === c.equipo_id);
                  const unidad = equipo ? unidadDeUso(equipo.code) : null;
                  return (
                    <tr key={c.id} style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : undefined }}>
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
                      <td className="text-slate-500">
                        {c.observaciones ?? ""}
                        {c.sheets_pendiente && <span className="ml-2 text-xs text-amber-600" title={c.sheets_pendiente}>⚠ sin exportar a la planilla</span>}
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
