"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";
import type { ReparacionDB } from "@/lib/tallerVial/types";
import RepuestosDelTrabajo from "../RepuestosDelTrabajo";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const TIPOS = ["Reparación", "Revisión"];

export default function ReparacionesClient({
  equipos, reparaciones, puedeEditar,
}: {
  equipos: EquipoTallerVial[];
  reparaciones: ReparacionDB[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);

  const [equipoId, setEquipoId] = useState(equipos[0]?.id ?? "");
  const [tipo, setTipo] = useState(TIPOS[0]);
  const [fecha, setFecha] = useState(hoy);
  const [descripcion, setDescripcion] = useState("");
  const [horas, setHoras] = useState("");
  const [horometro, setHorometro] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);

  async function cargar() {
    if (!equipoId) { setError("Elegí un equipo"); return; }
    if (!descripcion.trim()) { setError("Contá qué se le hizo al equipo"); return; }

    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/taller-vial/reparaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipo_id: equipoId,
          tipo,
          fecha,
          descripcion: descripcion.trim(),
          horas: horas.trim() === "" ? null : Number(horas.replace(",", ".")),
          horometro: horometro.trim() === "" ? null : Number(horometro.replace(",", ".")),
          observaciones: observaciones.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      setDescripcion("");
      setHoras("");
      setHorometro("");
      setObservaciones("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    if (!confirm("¿Borrar esta reparación?")) return;
    const res = await fetch(`/api/taller-vial/reparaciones?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "No se pudo borrar"); return; }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Reparaciones</h1>
        <p className="page-subheader">El historial de intervenciones a cada equipo.</p>
      </div>

      {puedeEditar && (
        <section className="card mt-4 p-4">
          <h2 className="section-title">Cargar una reparación</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
            <select className="input sm:col-span-2" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
              {equipos.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.code} - {eq.name}</option>
              ))}
            </select>
            <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <input
              className="input" inputMode="decimal" placeholder="Horas de trabajo (opcional)"
              value={horas} onChange={(e) => setHoras(e.target.value)}
            />
          </div>
          <div className="mt-2">
            <input
              className="input w-full" placeholder="Qué se le hizo al equipo"
              value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
            <input
              className="input" inputMode="decimal" placeholder="Horómetro (opcional)"
              value={horometro} onChange={(e) => setHorometro(e.target.value)}
            />
            <input
              className="input sm:col-span-2" placeholder="Observaciones (opcional)"
              value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
            />
            <button className="btn-primary" disabled={guardando} onClick={cargar}>Cargar</button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>
      )}

      <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Equipo</th>
                <th>Tipo</th>
                <th>Descripción</th>
                <th className="text-right">Horas</th>
                <th className="text-right">Horómetro</th>
                <th>Observaciones</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reparaciones.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-slate-400">Todavía no hay ninguna reparación cargada.</td></tr>
              ) : (
                reparaciones.map((r) => {
                  const equipo = equipos.find((e) => e.id === r.equipo_id);
                  const abierta = filaAbierta === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="whitespace-nowrap">{r.fecha}</td>
                        <td className="text-slate-800">{equipo ? `${equipo.code} - ${equipo.name}` : "—"}</td>
                        <td className="text-slate-500">{r.tipo}</td>
                        <td className="text-slate-700">{r.descripcion}</td>
                        <td className="text-right font-mono tabular-nums">{r.horas !== null ? num0.format(r.horas) : "—"}</td>
                        <td className="text-right font-mono tabular-nums">{r.horometro !== null ? num0.format(r.horometro) : "—"}</td>
                        <td className="text-slate-500">{r.observaciones ?? ""}</td>
                        <td className="whitespace-nowrap text-right">
                          <button className="text-xs text-slate-400 underline" onClick={() => setFilaAbierta(abierta ? null : r.id)}>
                            {abierta ? "Ocultar" : "Repuestos"}
                          </button>
                          {puedeEditar && (
                            <button className="ml-2 text-xs text-slate-400 underline hover:text-red-600" onClick={() => borrar(r.id)}>Borrar</button>
                          )}
                        </td>
                      </tr>
                      {abierta && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50 p-3">
                            <RepuestosDelTrabajo reparacionId={r.id} puedeEditar={puedeEditar} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
