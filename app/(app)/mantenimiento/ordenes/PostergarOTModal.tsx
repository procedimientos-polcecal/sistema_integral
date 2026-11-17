"use client";

import { useState, useEffect } from "react";
import Select from "@/components/Select";
import { Modal, PieDeModal } from "@/components/Modal";
import { useBorrador } from "@/lib/core/useBorrador";
import { claveDelBorrador } from "@/lib/core/borradorDeFormulario";
import { laRazonQueSeGuarda, MAXIMO_DE_DIAS } from "@/lib/mantenimiento/postergar";

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
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  /*
   * Los tres campos del formulario, recordados mientras la app esté abierta.
   *
   * **`null` quiere decir «todavía no lo tocó nadie»**, y no es un adorno: la
   * razón y los días vienen puestos desde la configuración, que llega **después**
   * de montar el modal. Si el valor por omisión se escribiera en el estado, el
   * formulario figuraría tocado por haber terminado de cargar una lista, y la
   * pregunta al salir saltaría sobre un formulario que nadie escribió — que es
   * justo lo que enseña a pasarla por alto la vez que sí importaba. Por eso el
   * valor por omisión se **deriva al pintar** (abajo) en vez de guardarse.
   *
   * `""` y `null` son dos cosas distintas en `dias`: vaciar el campo para
   * retipearlo es haberlo tocado y tiene que quedar vacío, no volver al número
   * de la razón.
   *
   * Los tres van juntos o ninguno: restaurar la justificación y perder la razón
   * dejaría el formulario diciendo un motivo que nadie eligió, que es peor que
   * perderlo entero.
   */
  const { valores, cambiar, tocado, tirar } = useBorrador(
    claveDelBorrador("mantenimiento-postergar-ot", { tipo: "ot", id: orden.id }),
    { razon: null as string | null, dias: null as string | null, justificacion: "" },
  );
  const { justificacion } = valores;

  useEffect(() => {
    let vigente = true;
    fetch("/api/mantenimiento/razones-postergacion")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => {
        if (!vigente) return;
        setRazones((b.data ?? []).filter((r: Razon) => r.activa));
      })
      .catch(() => { if (vigente) setRazones([]); });
    return () => { vigente = false; };
  }, []);

  // La razón elegida, o la primera de la configuración mientras nadie elija.
  const razon = valores.razon ?? razones[0]?.codigo ?? "";
  // Los días de esa razón, mientras nadie los corrija.
  const dias = valores.dias ?? String(razones.find((r) => r.codigo === razon)?.dias ?? "");

  // Cambiar de razón devuelve los días a los de la razón nueva: vuelven a quedar
  // sin tocar, así que si se cambia otra vez siguen al desplegable. Y elegir a
  // mano **la que ya estaba mostrada** no es tocar nada: se guarda `null`, o
  // salir preguntaría «¿descartar lo escrito?» sobre un formulario intacto
  // (`laRazonQueSeGuarda`, con el porqué).
  function elegirRazon(codigo: string) {
    cambiar({ razon: laRazonQueSeGuarda(codigo, razones[0]?.codigo), dias: null });
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
    // Recién con el guardado en verde no hay nada que recordar.
    tirar();
    onPostergada();
  }

  const falta = !razon || !justificacion.trim() || !Number.isInteger(Number(dias)) || Number(dias) <= 0;

  return (
    // El fondo, la X y Escape salen conservando: la justificación a medio
    // escribir queda y aparece igual al volver a abrir. Sólo «Cancelar» tira.
    <Modal titulo={`Postergar la OT #${orden.ot_number}`} alSalir={onCerrar} tocado={tocado}>
      <div className="space-y-4">
        <p className="-mt-2 text-xs text-slate-500">
          {orden.fecha_ejecucion
            ? `Hoy está para el ${orden.fecha_ejecucion.split("-").reverse().join("/")}.`
            : "Esta orden no tiene fecha de inicio."}
        </p>

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
                  value={dias} onChange={(e) => cambiar({ dias: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Justificación <span className="text-red-600">*</span>
              </label>
              <textarea
                className="input min-h-20" value={justificacion}
                onChange={(e) => cambiar({ justificacion: e.target.value })}
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

        <PieDeModal className="flex justify-end gap-2">
          {/* El único que tira. */}
          <button onClick={() => { tirar(); onCerrar(); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={postergar}
            disabled={falta || guardando || razones.length === 0}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {guardando ? "Postergando…" : "Postergar"}
          </button>
        </PieDeModal>
      </div>
    </Modal>
  );
}
