"use client";

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
 * Sin entradas no dibuja nada: una franja vacía enseñaría a ignorarla.
 */

const MOSTRADAS = 3;

export default function BandaDeAlertas({
  entradas, onEntrada,
}: {
  entradas: EntradaDeLaBanda[];
  onEntrada: (eventoId: string) => void;
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
      {restantes > 0 && <p className="mt-0.5">y {restantes} más</p>}
    </div>
  );
}
