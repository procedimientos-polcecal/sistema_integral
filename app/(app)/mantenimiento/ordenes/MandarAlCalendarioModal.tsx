"use client";

import { useEffect, useState } from "react";
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
 *
 * ── SI ALGUIEN TOCÓ EL EVENTO EN GOOGLE, SE DICE ANTES ──────────────────────
 *
 * Mandar una orden cuyo evento divergió (lo movieron o lo borraron desde
 * Google) lo pisa. Está bien que lo haga —para una OT la verdad es la orden—,
 * pero avisar después no alcanza: quien reenvía probablemente no sabe que
 * alguien lo cambió. Al abrirse, el modal pregunta cómo está el evento, y si
 * divergió muestra el horario que Google tiene hoy contra el que se va a
 * escribir, y no deja mandar hasta que la persona confirme que pisa.
 */

/** `2026-11-03T08:00:00` como se lee: «03/11/2026 08:00». */
function comoSeLeeLaHora(paredDeArgentina: string): string {
  return `${comoSeLee(paredDeArgentina.slice(0, 10))} ${paredDeArgentina.slice(11, 16)}`;
}

interface EstadoDelEvento {
  divergencia: "borrado" | "movido" | null;
  google: { inicio: string; fin: string } | null;
  google_error: string | null;
  /** A quién se sumó a mano antes: se precarga, porque reenviar reemplaza la lista. */
  invitados_extra: string[];
}

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
  const [listo, setListo] = useState<
    { reemplazo: boolean; escrito: boolean; advertencia: string | null } | null
  >(null);
  // `undefined` es que todavía no se sabe; `null`, que no se pudo saber.
  const [estado, setEstado] = useState<EstadoDelEvento | null | undefined>(undefined);
  const [errorDelEstado, setErrorDelEstado] = useState("");
  const [pisar, setPisar] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch(`/api/mantenimiento/ordenes/${orden.id}/calendario`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? `El servidor contestó ${r.status}`);
        return b as EstadoDelEvento;
      })
      .then((b) => {
        if (!vigente) return;
        setEstado(b);
        // Reenviar reemplaza la lista de invitados: los extras de la vez
        // anterior arrancan puestos, o quien sólo cambia el turno los sacaría
        // sin enterarse (y a cada uno le llegaría una cancelación).
        setExtras(b.invitados_extra ?? []);
      })
      .catch((e) => {
        if (!vigente) return;
        setEstado(null);
        setErrorDelEstado(e instanceof Error ? e.message : String(e));
      });
    return () => { vigente = false; };
  }, [orden.id]);

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
        body: JSON.stringify({ turno, invitados: extras, pisar }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Divergió entre que se abrió el modal y ahora: no hay casilla que marcar todavía.
        setError(
          (body.error ?? "No se pudo mandar la orden al calendario.") +
            (body.requiere_confirmacion ? " Cerrá esta ventana y volvé a abrirla para verlo." : "")
        );
        return;
      }
      setListo({
        reemplazo: Boolean(body.reemplazo),
        // Sin dato se supone que no: un verde de más es la mentira.
        escrito: body.google?.escrito === true,
        advertencia: body.advertencia ?? null,
      });
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
            {/* El titular mira lo que pasó con Google: el SdG guardó el evento
                aunque Google haya fallado, y decir «está en el calendario» sería
                mentir. La advertencia de abajo trae el detalle. */}
            {listo.escrito ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                {listo.reemplazo
                  ? "La orden ya estaba en el calendario: se movió al turno elegido."
                  : "La orden está en el calendario."}
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                La orden se guardó en el SdG, pero todavía no está en el calendario.
              </div>
            )}
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

            {estado === undefined && <p className="text-xs text-slate-400">Comprobando el evento…</p>}
            {estado === null && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                No se pudo comprobar si la orden ya está en el calendario, y sin eso no se manda: {errorDelEstado}
              </div>
            )}

            {estado?.divergencia && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">
                  {estado.divergencia === "borrado"
                    ? "Alguien borró este evento desde Google."
                    : "Alguien movió este evento desde Google."}
                </p>
                {estado.divergencia === "movido" && (
                  <p>
                    {estado.google
                      ? `Hoy Google lo tiene el ${comoSeLeeLaHora(estado.google.inicio)} a ${estado.google.fin.slice(11, 16)}.`
                      : `No se pudo leer qué horario tiene Google hoy${estado.google_error ? `: ${estado.google_error}` : "."}`}
                  </p>
                )}
                {horario && (
                  <p>
                    Si seguís, queda el {comoSeLeeLaHora(horario.inicio)} a {horario.fin.slice(11, 16)}
                    {estado.divergencia === "borrado" ? " (se vuelve a crear)" : ""} y lo que se hizo en
                    Google se pierde.
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox" className="mt-0.5" checked={pisar}
                    onChange={(e) => setPisar(e.target.checked)}
                  />
                  <span>Entiendo que se pisa lo que se hizo en Google</span>
                </label>
              </div>
            )}

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
                onClick={mandar}
                disabled={!fecha || guardando || !estado || (Boolean(estado.divergencia) && !pisar)}
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
