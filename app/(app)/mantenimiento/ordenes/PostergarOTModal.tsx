"use client";

import { useState, useEffect } from "react";
import Select from "@/components/Select";
import { MAXIMO_DE_DIAS } from "@/lib/mantenimiento/postergar";

interface Razon {
  codigo: string;
  etiqueta: string;
  dias: number;
  activa: boolean;
}

/**
 * Correrle la fecha de ejecución a una orden.
 *
 * ── LA JUSTIFICACIÓN ES OBLIGATORIA Y NO HAY CAMINO QUE LA ESQUIVE ──────────
 *
 * Si se pudiera postergar sin escribir nada, en un mes no habría ninguna
 * justificación — y la pregunta que esto existe para contestar es justamente
 * «¿por qué esta OT viene de octubre?». El botón queda deshabilitado hasta que
 * haya texto, y el servidor lo vuelve a exigir: una regla que vive sólo en la
 * pantalla no es una regla.
 *
 * ── LOS DÍAS VIENEN PUESTOS Y SE PUEDEN CAMBIAR ─────────────────────────────
 *
 * Los trae la razón elegida, de la configuración del módulo. Que vengan puestos
 * es lo que hace que postergar sea un gesto y no un formulario; que se puedan
 * cambiar es lo que evita que la configuración decida por quien está mirando el
 * caso concreto.
 */
export default function PostergarOTModal({
  orden, onCerrar, onPostergada,
}: {
  orden: { id: string; ot_number: number; fecha_ejecucion: string | null };
  onCerrar: () => void;
  onPostergada: () => void;
}) {
  const [razones, setRazones] = useState<Razon[]>([]);
  const [razon, setRazon] = useState("");
  const [dias, setDias] = useState("");
  const [justificacion, setJustificacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    fetch("/api/mantenimiento/razones-postergacion")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => {
        if (!vigente) return;
        const activas = (b.data ?? []).filter((r: Razon) => r.activa);
        setRazones(activas);
        if (activas.length > 0) {
          setRazon(activas[0].codigo);
          setDias(String(activas[0].dias));
        }
      })
      .catch(() => { if (vigente) setRazones([]); });
    return () => { vigente = false; };
  }, []);

  function elegirRazon(codigo: string) {
    setRazon(codigo);
    const r = razones.find((x) => x.codigo === codigo);
    if (r) setDias(String(r.dias));
  }

  async function postergar() {
    setGuardando(true);
    setError("");

    const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/postergar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razon, dias: Number(dias), justificacion }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo postergar.");
      return;
    }
    onPostergada();
  }

  const falta = !razon || !justificacion.trim() || !Number.isInteger(Number(dias)) || Number(dias) <= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Postergar la OT <span className="font-mono text-sm text-slate-500">#{orden.ot_number}</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {orden.fecha_ejecucion
              ? `Hoy está para el ${orden.fecha_ejecucion.split("-").reverse().join("/")}.`
              : "Esta orden no tiene fecha de ejecución."}
          </p>
        </div>

        {razones.length === 0 ? (
          <p className="text-sm text-slate-500">
            No hay razones cargadas. Se configuran en Mantenimiento → Configuración.
          </p>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Por qué</label>
              <Select value={razon} onChange={(e) => elegirRazon(e.target.value)} className="input">
                {razones.map((r) => (
                  <option key={r.codigo} value={r.codigo}>{r.etiqueta}</option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Cuántos días</label>
              {/* El ancho va en el `div`: `.input` trae `width: 100%` fuera de
                  toda capa y le gana a cualquier `w-*` de al lado. */}
              <div className="w-24">
                <input
                  type="number" min={1} max={MAXIMO_DE_DIAS} className="input"
                  value={dias} onChange={(e) => setDias(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Justificación <span className="text-red-600">*</span>
              </label>
              <textarea
                className="input min-h-20" value={justificacion}
                onChange={(e) => setJustificacion(e.target.value)}
                placeholder="Qué pasó, con las palabras de quien lo sabe."
              />
              <p className="mt-1 text-xs text-slate-400">
                Queda en el historial de la orden y viaja a la planilla.
              </p>
            </div>
          </>
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
            onClick={postergar}
            disabled={falta || guardando || razones.length === 0}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {guardando ? "Postergando…" : "Postergar"}
          </button>
        </div>
      </div>
    </div>
  );
}
