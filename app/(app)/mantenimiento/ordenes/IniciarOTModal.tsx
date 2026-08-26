"use client";

import { useState } from "react";

/**
 * Empezar una orden de trabajo.
 *
 * Poner una OT "en proceso" quiere decir que alguien va a intervenir la
 * máquina, y eso casi siempre cambia en qué estado queda el equipo. Preguntarlo
 * acá es lo que evita el caso feo: el equipo figura operativo en el sistema
 * mientras está desarmado.
 */

/** Los estados en que puede quedar un equipo mientras se trabaja sobre él. */
const ESTADOS = [
  { valor: "OPERATIVO", label: "Operativo", color: "#16A34A", bg: "#F0FDF4" },
  { valor: "EN_MANTENIMIENTO", label: "En mantenimiento", color: "#1D4ED8", bg: "#EFF6FF" },
  { valor: "FUERA_DE_SERVICIO", label: "Fuera de servicio", color: "#64748B", bg: "#F1F5F9" },
] as const;

/** Dejar una máquina parada hay que justificarlo. */
const PIDEN_MOTIVO = ["EN_MANTENIMIENTO", "FUERA_DE_SERVICIO"];

const LABEL: Record<string, string> = Object.fromEntries(ESTADOS.map((e) => [e.valor, e.label]));

export default function IniciarOTModal({
  orden, equipoId, estadoActual, onCerrar, onIniciada,
}: {
  orden: { id: string; ot_number: number | null; equipo_raw: string | null; descripcion: string | null };
  /** El equipo del sistema al que la OT está enlazada, si lo está. */
  equipoId: string | null;
  /** El estado en que está hoy ese equipo, o null si no hay equipo enlazado. */
  estadoActual: string | null;
  onCerrar: () => void;
  onIniciada: () => void;
}) {
  const [elegido, setElegido] = useState(estadoActual ?? "OPERATIVO");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cambiaElEquipo = elegido !== estadoActual;
  const pideMotivo = cambiaElEquipo && PIDEN_MOTIVO.includes(elegido);

  async function confirmar() {
    if (pideMotivo && !motivo.trim()) {
      setError("Decí por qué el equipo queda en ese estado.");
      return;
    }
    setGuardando(true);
    setError("");

    // Primero la OT: es lo que el usuario vino a hacer.
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: orden.id, estado: "EN_PROCESO" }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setGuardando(false);
      setError(body.error ?? "No se pudo iniciar la OT.");
      return;
    }

    // El equipo, sólo si cambia: un cambio de estado al mismo estado ensucia
    // el historial con una línea que no dice nada.
    if (cambiaElEquipo && equipoId && estadoActual !== null) {
      const res2 = await fetch(`/api/mantenimiento/equipos/${equipoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_status",
          new_status: elegido,
          reason: motivo.trim() || null,
        }),
      });
      if (!res2.ok) {
        const body = await res2.json().catch(() => ({}));
        setGuardando(false);
        // La OT ya arrancó: hay que decir exactamente qué quedó a medias.
        setError(`La OT quedó en proceso, pero no se pudo cambiar el estado del equipo: ${body.error ?? ""}`);
        return;
      }
    }

    setGuardando(false);
    onIniciada();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-gray-900">Iniciar OT #{orden.ot_number ?? "—"}</h2>
          <p className="mt-0.5 text-xs text-gray-400">{orden.equipo_raw ?? orden.descripcion ?? ""}</p>
        </div>

        {estadoActual === null ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            La OT pasa a <b>En proceso</b>. No tiene un equipo del sistema enlazado, así que no hay
            estado de equipo que cambiar.
          </p>
        ) : (
          <>
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              La OT pasa a <b>En proceso</b>. ¿En qué estado queda el equipo mientras se hace el trabajo?
              <span className="mt-0.5 block text-blue-500">
                Ahora está: {LABEL[estadoActual] ?? estadoActual}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {ESTADOS.map((e) => {
                const seleccionado = elegido === e.valor;
                return (
                  <button
                    key={e.valor}
                    onClick={() => { setElegido(e.valor); setError(""); }}
                    className="rounded-xl border-2 px-3 py-2.5 text-center text-xs font-semibold"
                    style={{
                      borderColor: seleccionado ? e.color : "#E2E8F0",
                      background: seleccionado ? e.bg : "#fff",
                      color: seleccionado ? e.color : "#64748B",
                    }}
                  >
                    {e.label}
                    {estadoActual === e.valor && (
                      <span className="block text-[10px] font-normal opacity-70">como está ahora</span>
                    )}
                  </button>
                );
              })}
            </div>

            {pideMotivo && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">
                  Motivo <span className="text-red-500">*</span>
                </label>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Por qué el equipo queda en ese estado…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
              </div>
            )}

            {!cambiaElEquipo && (
              <p className="text-xs text-gray-400">
                El equipo queda como está ({LABEL[estadoActual] ?? estadoActual}).
              </p>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={confirmar}
            disabled={guardando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Iniciar OT"}
          </button>
          <button
            onClick={onCerrar}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
