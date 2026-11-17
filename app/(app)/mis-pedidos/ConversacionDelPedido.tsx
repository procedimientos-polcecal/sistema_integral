"use client";

import { useState } from "react";
import HiloDeMensajes from "@/components/HiloDeMensajes";
import { Modal } from "@/components/Modal";

/**
 * El hilo de mensajes de un pedido, para quien no tiene el módulo Compras.
 *
 * **Existe porque un requerimiento lo ven los catorce y el módulo Compras lo
 * tienen ocho.** `compras_requerimientos` tiene la lectura abierta a propósito
 * (el circuito de compras es transversal a la empresa), y el hilo sigue al
 * registro y no al módulo: si viviera sólo en `compras/requerimientos/[id]`,
 * los que piden desde «Mis pedidos» pero no están en Compras podrían ser
 * mencionados y no tendrían dónde leer ni contestar. Por lo mismo el enlace del
 * correo de un requerimiento apunta acá y no al detalle del módulo
 * (`?pedido=`, ver `ENTIDADES.requerimiento.ruta`): el layout de Compras manda a
 * esta pantalla a quien no lo tiene, y a los seis los dejaba en una lista.
 *
 * **Es un diálogo y no un renglón que se despliega**, por dos razones de
 * tamaño. La tabla de escritorio está dentro de un `overflow-hidden` con otro
 * `overflow-x-auto`, y un requerimiento le pasa al desplegable de menciones los
 * catorce usuarios: arriba de diez opciones abre un panel flotante, y adentro
 * de la tabla se recortaría dejando nombres que el mouse no alcanza. Y una
 * tarjeta del teléfono con un campo de texto y un desplegable adentro deja de
 * ser una tarjeta. Pasa por el `Modal` compartido, como `FichaDeCondicion`.
 */
export default function ConversacionDelPedido({
  id, nroRi, descripcion, onCerrar, textoInicial, mencionesIniciales,
}: {
  id: string;
  nroRi: number;
  descripcion: string;
  onCerrar: () => void;
  /** Cuando se llega por «Reclamar»: la pregunta ya redactada, editable. */
  textoInicial?: string;
  /** Y los de Compras ya marcados, para que reclamar sea un clic y no elegir de a quince. */
  mencionesIniciales?: string[];
}) {
  // Lo escrito y no enviado vive adentro del hilo; avisa acá para no tirarlo
  // sin que se note. Mismo criterio que la ficha de la condición: con cambios
  // sin guardar, el botón dice «Descartar y cerrar».
  const [hayBorrador, setHayBorrador] = useState(false);

  // Con algo escrito y sin enviar, el fondo, la X y Escape **no cierran**: el
  // hilo vive adentro de este diálogo y cerrarlo lo desmonta con el borrador.
  // Todavía no hay borrador que sobreviva a un cierre (llega con el cartel de
  // «salir»), así que hasta entonces lo único que tira lo escrito es el botón
  // «Descartar y cerrar». Escape ya atendido por el desplegable de menciones lo
  // filtra el propio `Modal` (`defaultPrevented`).
  const salir = () => { if (!hayBorrador) onCerrar(); };

  return (
    <Modal titulo={`Pedido RI N° ${nroRi}`} alSalir={salir} ancho="ancho">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words text-sm text-slate-500">{descripcion}</p>
          <button type="button" onClick={onCerrar} className="btn-secondary shrink-0">
            {hayBorrador ? "Descartar y cerrar" : "Cerrar"}
          </button>
        </div>

        <HiloDeMensajes
          tipo="requerimiento"
          id={id}
          alCambiarElBorrador={setHayBorrador}
          abiertoAlMontar
          textoInicial={textoInicial}
          mencionesIniciales={mencionesIniciales}
          aclaracion={
            "Es una conversación con otras personas: no cambia el estado del pedido ni llega a " +
            "la planilla de Compras. Un requerimiento lo ve toda persona con acceso al sistema, " +
            "y este hilo también."
          }
        />
      </div>
    </Modal>
  );
}
