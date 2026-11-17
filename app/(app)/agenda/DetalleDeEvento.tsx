"use client";

import { Modal, PieDeModal } from "@/components/Modal";
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
 * **Escape se escucha en `document` (lo hace el `Modal`), así que no sabe si hay otro modal encima.**
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

  // Es un visor: no hay nada cargado que tirar, así que sale derecho. El `Modal`
  // atiende Escape, el fondo y la X; `cerrar` sigue frenando mientras hay una
  // acción en curso.
  return (
    <Modal titulo={cuerpo.evento.titulo} alSalir={cerrar} soloLectura>
      {/* `CuerpoDeEvento` trae su propio `p-4`: se descuenta el margen lateral
          del cuerpo del modal para que el texto no quede doblemente sangrado. */}
      <div className="-mx-4">
        <CuerpoDeEvento {...cuerpo} sinTitulo />
      </div>
      <PieDeModal>
        <button type="button" className="btn-secondary disabled:opacity-50" disabled={cuerpo.ocupado} onClick={cerrar}>Cerrar</button>
      </PieDeModal>
    </Modal>
  );
}
