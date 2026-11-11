"use client";

import { useEffect, useState } from "react";
import HiloDeMensajes from "@/components/HiloDeMensajes";

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
 * ser una tarjeta. El mismo patrón que `FichaDeCondicion`: un overlay que
 * scrollea y una caja interior **sin** `overflow`.
 */
export default function ConversacionDelPedido({
  id, nroRi, descripcion, onCerrar,
}: {
  id: string;
  nroRi: number;
  descripcion: string;
  onCerrar: () => void;
}) {
  // Lo escrito y no enviado vive adentro del hilo; avisa acá para no tirarlo
  // sin que se note. Mismo criterio que la ficha de la condición: con cambios
  // sin guardar, el botón dice «Descartar y cerrar».
  const [hayBorrador, setHayBorrador] = useState(false);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      // Escape **no** cierra el diálogo si ya lo atendió otro, ni si hay un
      // borrador. El desplegable de menciones cierra su panel con Escape y hace
      // `preventDefault` sin frenar la propagación: sin esta guarda, cerrar el
      // panel cerraba también el diálogo y se perdía lo escrito. Y apretarlo
      // desde el campo de texto con algo escrito haría lo mismo, sin avisar.
      if (e.key !== "Escape" || e.defaultPrevented || hayBorrador) return;
      onCerrar();
    }
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar, hayBorrador]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Mensajes del requerimiento ${nroRi}`}
    >
      <div className="w-full max-w-2xl bg-white sm:rounded-xl sm:shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-lg font-bold text-slate-900">Pedido RI N° {nroRi}</h2>
            <p className="break-words text-sm text-slate-500">{descripcion}</p>
          </div>
          <button type="button" onClick={onCerrar} className="btn-secondary shrink-0">
            {hayBorrador ? "Descartar y cerrar" : "Cerrar"}
          </button>
        </div>

        <div className="p-4">
          <HiloDeMensajes
            tipo="requerimiento"
            id={id}
            alCambiarElBorrador={setHayBorrador}
            aclaracion={
              "Es una conversación con otras personas: no cambia el estado del pedido ni llega a " +
              "la planilla de Compras. Un requerimiento lo ve toda persona con acceso al sistema, " +
              "y este hilo también."
            }
          />
        </div>
      </div>
    </div>
  );
}
