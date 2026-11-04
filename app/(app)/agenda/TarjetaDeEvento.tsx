"use client";

import CuerpoDeEvento, { type Props } from "./CuerpoDeEvento";

/**
 * Un evento de la Agenda dentro de su tarjeta. Todo lo que dice el evento y sus
 * botones viven en `CuerpoDeEvento`, que comparte con `DetalleDeEvento`: así la
 * tarjeta y el detalle no pueden decir cosas distintas.
 */
export default function TarjetaDeEvento(props: Props) {
  return (
    <div className="card overflow-hidden">
      <CuerpoDeEvento {...props} />
    </div>
  );
}
