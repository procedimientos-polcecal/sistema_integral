"use client";

import { useState } from "react";
import type { Aviso } from "@/lib/mantenimiento/types";
import {
  comoSeLeeLaOT, type OTAEnlazar,
} from "@/lib/mantenimiento/enlazarOtAlAviso";

/**
 * Colgar el aviso de una orden de trabajo que ya existe.
 *
 * **Se escribe el número, y antes de enlazar se lee la orden.** Ésa es toda la
 * pantalla, y el orden importa: un número tipeado se equivoca con un dedo, y
 * un enlace equivocado no se nota nunca —el aviso desaparece de «sin orden de
 * trabajo» y el trabajo que reportaba queda sin que nadie lo tome—. Por eso el
 * botón de enlazar **no existe hasta que la orden está en pantalla**: no se
 * puede confirmar lo que no se vio.
 *
 * Qué frena y qué sólo avisa lo decide `lib/mantenimiento/enlazarOtAlAviso.ts`
 * y lo contesta la ruta, que corre la misma regla cuando se aprieta. Esta
 * pantalla no tiene reglas propias: muestra las que le llegan.
 */
export default function EnlazarOTModal({ aviso, onClose, onEnlazada }: {
  aviso: Aviso;
  onClose: () => void;
  onEnlazada: (mensaje: string) => void;
}) {
  const [numero, setNumero] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  /** Lo que contestó la búsqueda. `null` es que todavía no se buscó. */
  const [encontrada, setEncontrada] = useState<{
    ot: OTAEnlazar; impide: string[]; mirar: string[];
  } | null>(null);

  /** Cambiar el número descarta la orden que estaba en pantalla: si no, se
   *  podría enlazar la 2814 mientras el campo dice 2815. */
  function escribirNumero(v: string) {
    setNumero(v);
    setEncontrada(null);
    setError("");
  }

  async function buscar() {
    setBuscando(true); setError(""); setEncontrada(null);
    const res = await fetch(
      `/api/mantenimiento/avisos/enlazar?numero=${encodeURIComponent(numero)}` +
      `&aviso=${encodeURIComponent(aviso.id)}`
    );
    const body = await res.json().catch(() => ({}));
    setBuscando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo buscar la OT."); return; }
    setEncontrada({ ot: body.data, impide: body.impide ?? [], mirar: body.mirar ?? [] });
  }

  async function enlazar() {
    setGuardando(true); setError("");
    const res = await fetch("/api/mantenimiento/avisos/enlazar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: aviso.id, numero }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo enlazar la OT."); return; }
    onEnlazada(body.mensaje);
  }

  const impedida = (encontrada?.impide.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-8 w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Enlazar una OT que ya existe</h2>
        <p className="mt-1 text-sm text-slate-500">
          Para el aviso {aviso.oa_number ?? "—"}. Es para cuando el trabajo ya se cargó
          por otro lado: no se crea ninguna orden y la que elijas no se toca.
        </p>

        <div className="mt-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">N° de la OT</span>
            <div className="flex gap-2">
              {/* El ancho va en el envoltorio y no en el input: una clase `w-*`
                  al lado de `.input` no mide lo que dice. Acá el input no usa
                  `.input`, pero el patrón es el mismo y se mantiene. */}
              <div className="w-32 shrink-0">
                <input
                  value={numero}
                  onChange={(e) => escribirNumero(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && numero.trim()) buscar(); }}
                  inputMode="numeric"
                  placeholder="2814"
                  autoFocus
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={buscar}
                disabled={buscando || !numero.trim()}
                className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {buscando ? "Buscando…" : "Buscar"}
              </button>
            </div>
          </label>
        </div>

        {encontrada && (
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-900">
              OT #{encontrada.ot.ot_number}
            </p>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {comoSeLeeLaOT(encontrada.ot).map((r) => (
                <div key={r.etiqueta}>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                    {r.etiqueta}
                  </dt>
                  <dd className="text-sm text-slate-700">{r.valor}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Lo que frena. No es un aviso: con esto en pantalla no hay botón. */}
        {encontrada?.impide.map((m) => (
          <p key={m} className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {m}
          </p>
        ))}

        {/* Lo que conviene mirar. Avisa y deja decidir: las dos cosas que
            nombra pasan de verdad —dos avisos de la misma falla, una OT
            escrita contra otro equipo del sector—. */}
        {encontrada?.mirar.map((m) => (
          <p key={m} className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {m}
          </p>
        ))}

        {error && (
          <p className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={enlazar}
            disabled={!encontrada || impedida || guardando}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {guardando
              ? "Enlazando…"
              : encontrada && !impedida
                ? `Enlazar la OT #${encontrada.ot.ot_number}`
                : "Enlazar"}
          </button>
        </div>
      </div>
    </div>
  );
}
