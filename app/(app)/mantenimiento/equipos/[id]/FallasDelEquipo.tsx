"use client";

import type { FallaContada } from "@/lib/mantenimiento/fallas";

/**
 * Qué falla se repite más en este equipo.
 *
 * Es lo que se pidió al agregar el campo: no la lista de fallas, sino cuál
 * vuelve. Por eso lo primero de cada renglón es cuántas veces pasó.
 *
 * POR QUÉ EL RÓTULO DICE "DESDE SIEMPRE"
 *
 * Justo arriba está la tarjeta de confiabilidad, que cuenta **fallas** de otra
 * manera: toda OT correctiva de los últimos 365 días. Dos números que dicen
 * "fallas" uno encima del otro se contradicen el día que alguien los compare,
 * así que éste dice de qué habla. Y es desde siempre a propósito: lo que se
 * quiere ver es qué se repite, y una falla de hace catorce meses es
 * exactamente eso.
 *
 * El detalle de cada OT se muestra acá porque **no hay ninguna otra pantalla
 * donde se vea**: en esta app no existe la página de una orden sola.
 */
export default function FallasDelEquipo({ fallas }: { fallas: FallaContada[] }) {
  // Van a ser casi todos los equipos durante meses: una tarjeta vacía repetida
  // en 178 fichas es ruido.
  if (fallas.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        Fallas registradas
        <span className="ml-2 text-xs font-normal text-slate-400">todas, desde siempre</span>
      </h2>

      <div className="card divide-y divide-slate-100">
        {fallas.map((f) => (
          <div key={`${f.modo ?? ""}|${f.causa ?? ""}`} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium text-slate-800">{f.titulo}</p>
              <p className="text-xs text-slate-400">
                {f.veces === 1 ? "1 vez" : `${f.veces} veces`}
                {f.ultimaFecha && ` · última el ${comoSeLee(f.ultimaFecha)}`}
              </p>
            </div>

            <ul className="mt-1 space-y-0.5">
              {f.ots.map((o) => (
                <li key={o.numero} className="flex gap-2 text-xs text-slate-500">
                  <span className="shrink-0 font-mono text-slate-400">#{o.numero}</span>
                  <span className="min-w-0">{o.detalle ?? "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * La fecha como se lee acá.
 *
 * Se parte el texto en vez de pasar por `Date`: un `new Date("2026-09-12")` se
 * lee como medianoche UTC y en Argentina muestra el día anterior.
 */
function comoSeLee(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
