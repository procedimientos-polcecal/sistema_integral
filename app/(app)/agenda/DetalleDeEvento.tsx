"use client";

import { useEffect } from "react";
import CuerpoDeEvento, { type Props } from "./CuerpoDeEvento";

/**
 * El detalle de un evento en un modal: lo mismo que dice la tarjeta, porque
 * dibuja el mismo `CuerpoDeEvento` con las mismas props.
 *
 * Es el lugar donde se ve y se toca un evento de la grilla, que no tiene
 * espacio para el panel de divergencia, la caja de la OT ni los botones. Que
 * salgan los mismos que en la tarjeta lo garantiza el componente compartido y
 * no una copia: qué botones le tocan a cada uno lo sigue decidiendo
 * `permisosDelEvento`.
 *
 * Se cierra con la X, con «Cerrar», con Escape y tocando el fondo oscuro.
 */
export default function DetalleDeEvento({
  onCerrar, ...cuerpo
}: Props & { onCerrar: () => void }) {
  // Escape cierra el detalle.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(ev) => { if (ev.target === ev.currentTarget) onCerrar(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="detalle-de-evento-titulo"
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="detalle-de-evento-titulo" className="min-w-0 break-words text-base font-bold text-slate-900">
            {cuerpo.evento.titulo}
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            onClick={onCerrar}
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto">
          <CuerpoDeEvento {...cuerpo} />
        </div>

        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <button type="button" className="btn-secondary" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
