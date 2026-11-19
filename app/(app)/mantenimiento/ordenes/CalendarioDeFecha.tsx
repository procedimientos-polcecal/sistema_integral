"use client";

import { Modal } from "@/components/Modal";
import CalendarioDeOT from "./CalendarioDeOT";

/**
 * El calendario que se abre al elegir la fecha de inicio de una OT: qué
 * tiene cada día del mes, para decidir dónde ubicar la próxima orden sin
 * apilar tareas del mismo tipo el mismo día.
 *
 * **Esto es sólo el modal**: la grilla, los filtros y el panel del día viven en
 * `CalendarioDeOT`, que comparte con la pestaña «Mes» de Programación. Lo que
 * queda acá es lo que es de este uso y no del otro —el `Modal` y su título—,
 * porque la pestaña no es un modal y no tiene nada que cerrar.
 */
export default function CalendarioDeFecha({
  valor, onElegir, onCerrar,
}: {
  /** La fecha que ya tiene el campo ("YYYY-MM-DD") o vacío. */
  valor: string;
  onElegir: (dia: string) => void;
  onCerrar: () => void;
}) {
  return (
    // Es un selector de fecha: nada que descartar (lo único «cargado» son los
    // filtros y el mes que se está mirando), así que sale derecho y nunca
    // pregunta. Escape, el fondo y la X lo cierran, y de eso se ocupa el
    // `Modal`: por eso no hay ningún listener propio acá.
    //
    // Se abre **encima** de otro formulario (`NuevaOTModal`). Antes iba con
    // `z-[60]` para quedar sobre el panel de abajo; ahora el `Modal` va en un
    // portal a `body` y, al montarse después, queda apilado encima del primero.
    <Modal titulo="Elegir la fecha de inicio" alSalir={onCerrar} soloLectura ancho="ancho">
      <CalendarioDeOT modo={{ tipo: "elegir", valor, onElegir }} />
    </Modal>
  );
}
