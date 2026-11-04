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
 * Se cierra con la X, con «Cerrar», con Escape y tocando el fondo oscuro —**salvo
 * mientras hay una acción en curso** (`ocupado`)—. Cerrarlo no cancela el
 * pedido, y quien lo cierra pierde de vista el estado de los botones y el error
 * que la pantalla muestre después. Es quien lo monta el que lo cierra cuando
 * la acción termina.
 *
 * **Escape se escucha en `document`, así que no sabe si hay otro modal encima.**
 * Quien lo monta lo resuelve: no lo mantiene montado mientras abre el editor, y
 * ignora el cierre mientras hay una confirmación abierta (que no atiende Escape:
 * un oyente global cerraría el detalle que queda debajo de ella). Se probó en el
 * navegador con un oyente en el diálogo y no alcanza: el foco se queda en el
 * botón que abrió la confirmación, así que la tecla llega igual.
 */
export default function DetalleDeEvento({
  onCerrar, ...cuerpo
}: Props & { onCerrar: () => void }) {
  const cerrar = () => { if (!cuerpo.ocupado) onCerrar(); };

  // Escape cierra el detalle. Sin lista de dependencias: `cerrar` lee `ocupado`
  // y tiene que ser el de este render.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(ev) => { if (ev.target === ev.currentTarget) cerrar(); }}
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
            disabled={cuerpo.ocupado}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            onClick={cerrar}
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto">
          <CuerpoDeEvento {...cuerpo} sinTitulo />
        </div>

        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <button type="button" className="btn-secondary" disabled={cuerpo.ocupado} onClick={cerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
