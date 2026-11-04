"use client";

import Link from "next/link";
import type { EntradaDeLaBanda } from "@/lib/agenda/banda";

/**
 * La franja ámbar encima de la grilla con lo que tiene algo que decir: un evento
 * que alguien movió o borró en Google, o que no llegó a escribirse allá.
 *
 * Una celda de calendario no tiene dónde poner un párrafo, así que el aviso
 * vive acá y el detalle y los botones, en el panel del evento al que lleva cada
 * entrada. Qué entra y en qué orden lo decide `entradasDeLaBanda`, que tiene
 * tests; esto sólo muestra las primeras y dice cuántas quedaron afuera, porque
 * una banda que crece sin tope empuja la grilla fuera de la pantalla.
 *
 * **«y N más» es un enlace a la Lista y no un texto**: una alerta que no entró
 * en las tres de arriba sólo tendría su bloque en la grilla, y ese bloque existe
 * únicamente si el evento cae en los días que se están dibujando. Las divergencias
 * no se van con «Ya lo vi» y van primero, así que tres de ellas dejan a todas las
 * demás sin otro camino. La Lista es la vista que ya muestra cada evento con
 * alerta con su texto completo y sus botones para destrabar, que la banda no
 * puede mostrar.
 *
 * Sin entradas no dibuja nada: una franja vacía enseñaría a ignorarla.
 */

const MOSTRADAS = 3;

export default function BandaDeAlertas({
  entradas, onEntrada, hrefDeLaLista,
}: {
  entradas: EntradaDeLaBanda[];
  onEntrada: (eventoId: string) => void;
  /** Adónde lleva «y N más»: la vista Lista, con el día y el historial que ya se miran. */
  hrefDeLaLista: string;
}) {
  if (entradas.length === 0) return null;

  const visibles = entradas.slice(0, MOSTRADAS);
  const restantes = entradas.length - visibles.length;

  return (
    <div
      role="region"
      aria-label="Eventos que necesitan atención"
      className="rounded-lg border px-3 py-2 text-sm"
      style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}
    >
      <p className="font-semibold">
        {entradas.length === 1 ? "1 evento necesita atención" : `${entradas.length} eventos necesitan atención`}
      </p>
      <ul className="mt-1 space-y-0.5">
        {visibles.map((e) => (
          <li key={e.eventoId} className="min-w-0">
            <button
              type="button"
              className="block w-full min-w-0 truncate text-left underline-offset-2 hover:underline"
              title={`${e.titulo} · ${e.texto}`}
              onClick={() => onEntrada(e.eventoId)}
            >
              <span className="font-medium">{e.titulo}</span> · {e.texto}
            </button>
          </li>
        ))}
      </ul>
      {restantes > 0 && (
        <Link href={hrefDeLaLista} className="mt-0.5 block font-medium underline">
          y {restantes} más
        </Link>
      )}
    </div>
  );
}
