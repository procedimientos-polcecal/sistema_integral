"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TIERS_DE_SERVICE, type EstadoDeServicePorTier, type LecturaDeService } from "@/lib/tallerVial/service";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";
import type { ServiceDB } from "@/lib/tallerVial/types";
import RepuestosDelTrabajo from "../RepuestosDelTrabajo";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

const ESTILO_LECTURA: Record<LecturaDeService, string> = {
  VENCIDO: "bg-red-50 text-red-700 border-red-200",
  PROXIMO: "bg-amber-50 text-amber-700 border-amber-200",
  AL_DIA: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const ETIQUETA_LECTURA: Record<LecturaDeService, string> = {
  VENCIDO: "Vencido",
  PROXIMO: "Próximo",
  AL_DIA: "Al día",
};

function BadgeLectura({ lectura }: { lectura: LecturaDeService | null }) {
  if (lectura === null) {
    return <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-400">Sin cargar</span>;
  }
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${ESTILO_LECTURA[lectura]}`}>
      {ETIQUETA_LECTURA[lectura]}
    </span>
  );
}

interface EstadoDeEquipo {
  equipo: EquipoTallerVial;
  horometroActual: number | null;
  escalones: EstadoDeServicePorTier[];
}

export default function ServicesClient({
  equipos, estadoPorEquipo, historial, puedeEditar,
}: {
  equipos: EquipoTallerVial[];
  estadoPorEquipo: EstadoDeEquipo[];
  historial: ServiceDB[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);

  const [equipoId, setEquipoId] = useState(equipos[0]?.id ?? "");
  const [tier, setTier] = useState<number>(TIERS_DE_SERVICE[0]);
  const [fecha, setFecha] = useState(hoy);
  const [horometro, setHorometro] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);

  async function cargar() {
    const horometroNum = Number(horometro.replace(",", "."));
    if (!equipoId) { setError("Elegí un equipo"); return; }
    if (!isFinite(horometroNum) || horometroNum < 0) { setError("El horómetro tiene que ser un número"); return; }

    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/taller-vial/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipo_id: equipoId, tier, fecha, horometro: horometroNum, observaciones: observaciones.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
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
    if (!confirm("¿Borrar este service?")) return;
    const res = await fetch(`/api/taller-vial/services?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "No se pudo borrar"); return; }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Services por horómetro</h1>
        <p className="page-subheader">250 / 500 / 1000 / 2000 hs, en cascada: el de 1000 cubre al de 500 y al de 250.</p>
      </div>

      {puedeEditar && (
        <section className="card mt-4 p-4">
          <h2 className="section-title">Cargar un service</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
            <select className="input sm:col-span-2" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
              {equipos.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.code} - {eq.name}</option>
              ))}
            </select>
            <select className="input" value={tier} onChange={(e) => setTier(Number(e.target.value))}>
              {TIERS_DE_SERVICE.map((t) => (
                <option key={t} value={t}>{t} hs</option>
              ))}
            </select>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <input
              className="input" inputMode="decimal" placeholder="Horómetro"
              value={horometro} onChange={(e) => setHorometro(e.target.value)}
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

      <div className="mt-4 space-y-3">
        {estadoPorEquipo.map(({ equipo, horometroActual, escalones }) => (
          <div key={equipo.id} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">{equipo.code} - {equipo.name}</span>
              <span className="text-xs text-slate-500">
                Horómetro actual: {horometroActual !== null ? num0.format(horometroActual) : "sin lectura reciente"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {escalones.map((esc) => (
                <div key={esc.tier} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">{esc.tier} hs</span>
                    <BadgeLectura lectura={esc.lectura} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {esc.proximoVencimiento !== null ? (
                      <>Próximo: {num0.format(esc.proximoVencimiento)}</>
                    ) : (
                      "Sin cargar todavía"
                    )}
                  </div>
                  {esc.horasFaltantes !== null && (
                    <div className={`text-xs ${esc.horasFaltantes <= 0 ? "text-red-600" : "text-slate-500"}`}>
                      {esc.horasFaltantes <= 0
                        ? `${num0.format(Math.abs(esc.horasFaltantes))} hs pasado`
                        : `Faltan ${num0.format(esc.horasFaltantes)} hs`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-6">
        <h2 className="section-title">Últimos services cargados</h2>
        <div className="card mt-2 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Equipo</th>
                <th className="text-right">Escalón</th>
                <th className="text-right">Horómetro</th>
                <th>Observaciones</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {historial.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400">Todavía no hay ningún service cargado.</td></tr>
              ) : (
                historial.map((s) => {
                  const equipo = equipos.find((e) => e.id === s.equipo_id);
                  const abierta = filaAbierta === s.id;
                  return (
                    <Fragment key={s.id}>
                      <tr>
                        <td className="whitespace-nowrap">{s.fecha}</td>
                        <td className="text-slate-800">{equipo ? `${equipo.code} - ${equipo.name}` : "—"}</td>
                        <td className="text-right font-mono tabular-nums">{s.tier} hs</td>
                        <td className="text-right font-mono tabular-nums">{num0.format(s.horometro)}</td>
                        <td className="text-slate-500">{s.observaciones ?? ""}</td>
                        <td className="whitespace-nowrap text-right">
                          <button className="text-xs text-slate-400 underline" onClick={() => setFilaAbierta(abierta ? null : s.id)}>
                            {abierta ? "Ocultar" : "Repuestos"}
                          </button>
                          {puedeEditar && (
                            <button className="ml-2 text-xs text-slate-400 underline hover:text-red-600" onClick={() => borrar(s.id)}>Borrar</button>
                          )}
                        </td>
                      </tr>
                      {abierta && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50 p-3">
                            <RepuestosDelTrabajo serviceId={s.id} puedeEditar={puedeEditar} />
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
