"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { comoSeLee } from "@/lib/core/fechas";
import {
  INVITADOS_DE_UNA_OT, TURNOS_DEL_TALLER, esCorreo, fechaParaElCalendario, horarioDeLaOT,
} from "@/lib/agenda/evento";
import type { Turno } from "@/lib/mantenimiento/programacion";

/**
 * Mandar una orden de trabajo al calendario.
 *
 * Se elige el turno del taller: el evento arranca con él y dura 1:30. Los cinco
 * invitados de siempre vienen puestos y se puede sumar a quien sea.
 *
 * **Volver a mandarla la mueve, no la duplica**: una OT tiene un solo evento.
 * Se dice acá, antes de apretar, porque «Mandar» sobre una orden que ya estaba
 * en el calendario manda otra vez la invitación a cada invitado.
 *
 * La fecha no se elige acá: sale de la orden (`fechaParaElCalendario`). Una
 * orden sin fecha ni siquiera llega a abrir este modal; el botón lo explica.
 */
export default function MandarAlCalendarioModal({
  orden, onCerrar, onMandada,
}: {
  orden: {
    id: string;
    ot_number: number;
    fecha_ejecucion: string | null;
    fecha_ejecucion_pendiente?: string | null;
  };
  onCerrar: () => void;
  /** Se mandó (haya o no una advertencia): quien llama puede refrescar. */
  onMandada: () => void;
}) {
  const fecha = fechaParaElCalendario(orden);
  const [turno, setTurno] = useState<Turno>("8-16");
  const [extras, setExtras] = useState<string[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [errorDelCorreo, setErrorDelCorreo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState<{ reemplazo: boolean; advertencia: string | null } | null>(null);

  const horario = fecha ? horarioDeLaOT(fecha, turno) : null;
  const horas = horario ? `${horario.inicio.slice(11, 16)} a ${horario.fin.slice(11, 16)}` : null;

  function sumar() {
    const correo = nuevo.trim().toLowerCase();
    if (!correo) return;
    if (!esCorreo(correo)) {
      setErrorDelCorreo(`«${correo}» no es un correo válido`);
      return;
    }
    if (INVITADOS_DE_UNA_OT.includes(correo) || extras.includes(correo)) {
      setErrorDelCorreo("Ya está en la lista");
      return;
    }
    setExtras([...extras, correo]);
    setNuevo("");
    setErrorDelCorreo("");
  }

  async function mandar() {
    setGuardando(true);
    setError("");
    try {
      const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/calendario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turno, invitados: extras }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "No se pudo mandar la orden al calendario.");
        return;
      }
      setListo({ reemplazo: Boolean(body.reemplazo), advertencia: body.advertencia ?? null });
    } catch (e) {
      setError(`No se pudo mandar la orden al calendario: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Mandar la OT <span className="font-mono text-sm text-slate-500">#{orden.ot_number}</span> al calendario
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {fecha
              ? `Va en la fecha de ejecución: ${comoSeLee(fecha)}.`
              : "Esta orden no tiene fecha de ejecución."}
          </p>
        </div>

        {listo ? (
          <>
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {listo.reemplazo
                ? "La orden ya estaba en el calendario: se movió al turno elegido."
                : "La orden está en el calendario."}
            </div>
            {listo.advertencia && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {listo.advertencia}
              </div>
            )}
            <div className="flex justify-end pt-1">
              <button onClick={onMandada} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
                Cerrar
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Turno</label>
              <Select value={turno} onChange={(e) => setTurno(e.target.value as Turno)} className="input">
                {TURNOS_DEL_TALLER.map((t) => (
                  <option key={t} value={t}>Turno {t}</option>
                ))}
              </Select>
              {horas && <p className="mt-1 text-xs text-slate-400">El evento va de {horas}.</p>}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Invitados</p>
              <ul className="space-y-0.5 text-sm text-slate-700">
                {INVITADOS_DE_UNA_OT.map((c) => (
                  <li key={c} className="truncate">{c}</li>
                ))}
                {extras.map((c) => (
                  <li key={c} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{c}</span>
                    <button
                      onClick={() => setExtras(extras.filter((x) => x !== c))}
                      className="shrink-0 text-xs font-semibold text-slate-500 underline hover:text-slate-900"
                    >
                      Sacar
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-slate-400">
                El evento queda a nombre de la casilla que generó la orden, y esa casilla no se invita a sí misma.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Sumar a alguien</label>
              <div className="flex gap-2">
                <input
                  type="email" className="input min-w-0 flex-1" placeholder="correo@empresa.com"
                  value={nuevo}
                  onChange={(e) => { setNuevo(e.target.value); setErrorDelCorreo(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sumar(); } }}
                />
                <button
                  onClick={sumar} disabled={!nuevo.trim()}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  Sumar
                </button>
              </div>
              {errorDelCorreo && <p className="mt-1 text-xs text-red-600">{errorDelCorreo}</p>}
            </div>

            <p className="text-xs text-slate-500">
              Una orden tiene un solo evento: si ya estaba en el calendario, esto lo mueve al turno elegido y
              no lo duplica, pero cada invitado recibe de nuevo el aviso.
            </p>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onCerrar} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={mandar} disabled={!fecha || guardando}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {guardando ? "Mandando…" : "Mandar al calendario"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
