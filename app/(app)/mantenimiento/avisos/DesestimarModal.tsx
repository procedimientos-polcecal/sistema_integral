"use client";

import { useState } from "react";
import {
  loQueFaltaParaDesestimar, MINIMO_DEL_MOTIVO,
} from "@/lib/mantenimiento/desestimarAviso";
import { hoyEnArgentina } from "@/lib/core/fechas";
import type { Aviso } from "@/lib/mantenimiento/types";

/**
 * Por qué este aviso no va a ser orden de trabajo.
 *
 * El motivo es obligatorio y la comprobación es la misma que corre el servidor
 * —`loQueFaltaParaDesestimar`—, no una copia: un aviso desestimado sin motivo
 * es lo mismo que uno ignorado, sólo que además parece resuelto.
 *
 * Lo que se escriba acá va a la columna `OBSERVACIONES` de la planilla, con la
 * fecha y el nombre adelante. Eso es **todo** lo que va a ver quien mire la
 * planilla y no entre al sistema, así que el texto se muestra tal como va a
 * quedar antes de guardarlo.
 */
export default function DesestimarModal({ aviso, onClose, onHecho }: {
  aviso: Aviso;
  onClose: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const falta = loQueFaltaParaDesestimar({ motivo, cuando: hoyEnArgentina(), quien: null });

  async function desestimar() {
    setGuardando(true); setError("");
    const res = await fetch("/api/mantenimiento/avisos/desestimar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: aviso.id, motivo }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo desestimar."); return; }

    onHecho(
      [
        `El aviso ${aviso.oa_number} quedó desestimado.`,
        body.planilla_error &&
          `Ojo: la planilla no se enteró (${body.planilla_error}). Quien la mire va a ` +
          `seguir viéndolo como pendiente hasta la próxima sincronización.`,
      ].filter(Boolean).join(" ")
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="mt-8 w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">
          Desestimar el aviso {aviso.oa_number}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Deja de contar como pendiente. No se borra: queda con el motivo, quién lo decidió
          y cuándo, y se puede volver atrás.
        </p>

        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-slate-700">{aviso.descripcion || "(sin descripción)"}</p>
          <p className="mt-1 text-xs text-slate-400">
            {[aviso.sector_raw, aviso.equipo_raw, aviso.quien_aviso].filter(Boolean).join(" · ")}
          </p>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            ¿Por qué no va a hacerse?
          </span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            autoFocus
            placeholder="El equipo se da de baja el mes que viene"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Lo va a leer alguien dentro de tres meses sin poder preguntarte. Mínimo{" "}
            {MINIMO_DEL_MOTIVO} caracteres.
          </span>
        </label>

        {/* Tal como va a quedar en la planilla: esa celda es todo lo que ve
            quien no entra al sistema. */}
        {falta.length === 0 && (
          <p className="mt-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            En la planilla va a decir:{" "}
            <span className="font-medium text-slate-700">
              Desestimado {enDiaMes(hoyEnArgentina())} por vos: {motivo.trim()}
            </span>
          </p>
        )}

        {error && (
          <p className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            onClick={desestimar}
            disabled={guardando || falta.length > 0}
            title={falta.length > 0 ? `Falta ${falta.join(", ")}.` : undefined}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Desestimar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "2026-10-21" → "21/10". */
function enDiaMes(fecha: string): string {
  const [, mes, dia] = String(fecha ?? "").split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : fecha;
}
