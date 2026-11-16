"use client";

import { useState } from "react";
import { avisoDelPendiente } from "@/lib/mantenimiento/reintentoDePendientes";
import { MAXIMO_DE_NOTA } from "@/lib/mantenimiento/notas";
import { ESTADO_CANCELADA } from "@/lib/mantenimiento/cancelacion";

/**
 * Cancelar una orden: decir que no se va a hacer nunca, y por qué.
 *
 * Es el tercer estado que la pantalla no cambia con un «¿confirmás?» y ya, igual
 * que empezar y realizar, y por la misma razón: sin preguntar, lo que importa se
 * pierde. Acá lo que importa es el motivo. Una OT cancelada sin explicación
 * desaparece del tablero y nadie vuelve a saber qué pasó, así que el botón no
 * se habilita mientras el campo esté vacío.
 *
 * Manda un solo PATCH, y es el servidor el que guarda el motivo junto con el
 * cambio de estado: si la nota no entra, la orden no se cancela. Acá no se
 * repiten sus otras reglas (estado de partida, largo); se muestra lo que diga.
 */
export default function CancelarOTModal({
  orden, onCerrar, onCancelada,
}: {
  orden: {
    id: string;
    ot_number: number | null;
    equipo_raw: string | null;
    descripcion: string | null;
  };
  onCerrar: () => void;
  onCancelada: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  async function cancelar() {
    setGuardando(true);
    setError("");

    // Sin `fecha_cierre`: cancelar nunca la pone, y la ruta rechaza si viaja.
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: orden.id,
        estado: ESTADO_CANCELADA,
        justificacion: motivo.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo cancelar la orden.");
      return;
    }
    // La orden ya quedó cancelada y con su motivo; lo único que puede faltar es
    // la planilla. Es el mismo aviso que dan el alta y el registro: si el
    // sistema va a insistir solo, no hay nada que completar a mano.
    const avisoDeLaPlanilla = avisoDelPendiente(
      body.planilla_error, Boolean(body.planilla_reintentando)
    );
    if (avisoDeLaPlanilla) {
      setAviso(`La orden quedó cancelada. ${avisoDeLaPlanilla}`);
      return;
    }
    onCancelada();
  }

  // Cerrada la cancelación no hay nada más que hacer acá: con el aviso a la
  // vista, el botón y el fondo sólo cierran, no vuelven a mandar nada.
  const terminada = Boolean(aviso);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center"
      onClick={terminada ? onCancelada : onCerrar}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-bold text-slate-900">Cancelar la orden</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            OT #{orden.ot_number ?? "—"} · {orden.equipo_raw ?? orden.descripcion ?? ""}
          </p>
        </div>

        <p className="text-sm text-slate-600">
          Cancelar quiere decir que esta orden <strong>no se va a hacer nunca</strong>.
          Si sólo se posterga, dejala abierta y justificá por qué todavía no se hizo.
          El motivo queda en el historial de la orden y en la planilla.
        </p>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        {aviso && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p>{aviso}</p>
            <button onClick={onCancelada} className="font-semibold underline">Entendido</button>
          </div>
        )}

        {!terminada && (
          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Por qué se cancela</span>
            <textarea
              value={motivo}
              onChange={(e) => { setMotivo(e.target.value); setError(""); }}
              maxLength={MAXIMO_DE_NOTA}
              rows={4}
              disabled={guardando}
              placeholder="El equipo se dio de baja y ya no hace falta el cambio de rodamiento."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="block text-right text-xs text-slate-400">
              {motivo.length} / {MAXIMO_DE_NOTA}
            </span>
          </label>
        )}

        {!terminada && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={cancelar}
              disabled={guardando || !motivo.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardando ? "Cancelando…" : "Cancelar la orden"}
            </button>
            <button
              onClick={onCerrar}
              disabled={guardando}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Volver
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
