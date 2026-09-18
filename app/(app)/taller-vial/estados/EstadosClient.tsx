"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ETIQUETA_ESTADO, type EstadoDiario } from "@/lib/tallerVial/estados";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";
import type { EstadoDiarioDB } from "@/lib/tallerVial/types";

const ESTILO_ESTADO: Record<EstadoDiario, string> = {
  OPERATIVO: "bg-emerald-50 text-emerald-700 border-emerald-200",
  OPERATIVO_CON_FALLAS: "bg-amber-50 text-amber-700 border-amber-200",
  FUERA_DE_SERVICIO: "bg-red-50 text-red-700 border-red-200",
};

const ESTADOS: EstadoDiario[] = ["OPERATIVO", "OPERATIVO_CON_FALLAS", "FUERA_DE_SERVICIO"];

function BadgeEstado({ estado }: { estado: EstadoDiario | null }) {
  if (estado === null) {
    return <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-400">Sin cargar</span>;
  }
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[estado]}`}>
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

export default function EstadosClient({
  equipos, estadoActual, historial, hoy, puedeEditar,
}: {
  equipos: EquipoTallerVial[];
  estadoActual: Record<string, EstadoDiario>;
  historial: EstadoDiarioDB[];
  hoy: string;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState<string | null>(null); // equipoId en vuelo, para deshabilitar sólo esa fila
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [mostrarFormFecha, setMostrarFormFecha] = useState(false);
  const [equipoId, setEquipoId] = useState(equipos[0]?.id ?? "");
  const [fecha, setFecha] = useState(hoy);
  const [estado, setEstado] = useState<EstadoDiario>("OPERATIVO");
  const [observaciones, setObservaciones] = useState("");
  const [guardandoForm, setGuardandoForm] = useState(false);

  async function guardar(equipoIdAGuardar: string, estadoAGuardar: EstadoDiario, fechaAGuardar: string, obs?: string) {
    setError(null);
    setAviso(null);
    try {
      const res = await fetch("/api/taller-vial/estados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipo_id: equipoIdAGuardar, fecha: fechaAGuardar, estado: estadoAGuardar, observaciones: obs || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      if (json.aviso) setAviso(json.aviso.mensaje);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  }

  async function cambioRapido(equipoIdAGuardar: string, estadoAGuardar: EstadoDiario) {
    setGuardando(equipoIdAGuardar);
    await guardar(equipoIdAGuardar, estadoAGuardar, hoy);
    setGuardando(null);
  }

  async function cargarConFecha() {
    setGuardandoForm(true);
    await guardar(equipoId, estado, fecha, observaciones.trim());
    setObservaciones("");
    setGuardandoForm(false);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Estado de los equipos</h1>
        <p className="page-subheader">Hoy: {hoy}</p>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {aviso && <p className="mt-3 text-sm text-amber-700">{aviso}</p>}

      <section className="mt-4">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Estado actual</th>
                  {puedeEditar && <th>Cambiar a</th>}
                </tr>
              </thead>
              <tbody>
                {equipos.map((eq, i) => (
                  <tr key={eq.id} style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : undefined }}>
                    <td className="font-medium text-slate-800">{eq.code} - {eq.name}</td>
                    <td><BadgeEstado estado={estadoActual[eq.id] ?? null} /></td>
                    {puedeEditar && (
                      <td>
                        <select
                          className="input"
                          disabled={guardando === eq.id}
                          value={estadoActual[eq.id] ?? ""}
                          onChange={(e) => cambioRapido(eq.id, e.target.value as EstadoDiario)}
                        >
                          {!estadoActual[eq.id] && <option value="" disabled>Elegir…</option>}
                          {ESTADOS.map((e) => (
                            <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>
                          ))}
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-400">Cambiar acá pone la fecha de hoy. Queda exportado a la planilla real.</p>
      </section>

      {puedeEditar && (
        <section className="mt-4">
          <button className="text-xs text-slate-500 underline" onClick={() => setMostrarFormFecha((v) => !v)}>
            {mostrarFormFecha ? "Ocultar" : "Cargar un estado con otra fecha, o con observaciones →"}
          </button>
          {mostrarFormFecha && (
            <div className="card mt-2 p-4">
              <p className="text-xs text-slate-500">Para corregir un día anterior, o anotar qué pasó (ej. "se rompió la bomba hidráulica").</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <select className="input sm:col-span-2" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
                  {equipos.map((eq) => (
                    <option key={eq.id} value={eq.id}>{eq.code} - {eq.name}</option>
                  ))}
                </select>
                <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} max={hoy} />
                <select className="input" value={estado} onChange={(e) => setEstado(e.target.value as EstadoDiario)}>
                  {ESTADOS.map((e) => (
                    <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>
                  ))}
                </select>
              </div>
              <div className="mt-2">
                <input
                  className="input w-full" placeholder="Observaciones (opcional) — ej. qué se rompió"
                  value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
                />
              </div>
              <div className="mt-3 flex justify-end">
                <button className="btn-primary" disabled={guardandoForm} onClick={cargarConFecha}>Guardar</button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="section-title">Historial reciente</h2>
        <div className="card mt-2 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Equipo</th>
                  <th>Estado</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-slate-400">Todavía no hay ningún estado cargado.</td></tr>
                ) : (
                  historial.map((h, i) => {
                    const equipo = equipos.find((e) => e.id === h.equipo_id);
                    return (
                      <tr key={h.id} style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : undefined }}>
                        <td className="whitespace-nowrap">{h.fecha}</td>
                        <td className="text-slate-800">{equipo ? `${equipo.code} - ${equipo.name}` : "—"}</td>
                        <td><BadgeEstado estado={h.estado as EstadoDiario} /></td>
                        <td className="text-slate-500">
                          {h.observaciones ?? ""}
                          {h.sheets_pendiente && <span className="ml-2 text-xs text-amber-600" title={h.sheets_pendiente}>⚠ sin exportar a la planilla</span>}
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
