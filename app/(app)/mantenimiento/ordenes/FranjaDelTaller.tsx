"use client";

import type { FranjaDeLaSemana } from "@/lib/mantenimiento/rotacionDeLaSemana";
import { TURNOS_DE_LA_FRANJA } from "@/lib/mantenimiento/rotacionDeLaSemana";

/**
 * La rotación de una semana, arriba de su fila en el mes de órdenes.
 *
 * ── POR QUÉ LA ROTACIÓN Y NO UN CONTEO ─────────────────────────────────────
 *
 * El pedido era «los operarios disponibles en cada semana del mes», y medido
 * contra producción el 19/11/2026 ese número sale **constante**: 4 mecánicos ·
 * 3 electricistas · 1 lubricador las nueve semanas de noviembre y diciembre.
 * Una franja que repite el mismo número nueve semanas seguidas deja de
 * mirarse. Lo que sí cambia todas las semanas es **quién está en qué turno**,
 * que es lo que hace falta para decidir a quién ponerle una orden.
 *
 * ── TRES COLUMNAS NO ENTRAN EN UN TELÉFONO ─────────────────────────────────
 *
 * El ancho útil es de 343 px, así que tres columnas quedan en 114 px y ahí no
 * entra un turno con sus nombres: va `grid-cols-1 sm:grid-cols-3`. Es la regla
 * de la casa y acá muerde más que en otros lados, porque esta pantalla se abre
 * desde la planta.
 */
export default function FranjaDelTaller({ franja, error }: {
  franja: FranjaDeLaSemana | null;
  /**
   * Por qué no se pudo traer el taller de esa semana. Un fallo acá **no rompe
   * el mes**: la grilla de órdenes es lo que la pantalla vino a mostrar y se
   * sigue viendo; esto dice, al lado, que la rotación no llegó.
   */
  error?: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-t-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
        No se pudo traer el taller de esta semana: {error}
      </div>
    );
  }

  if (!franja) return null;

  // `porTurno: null` no es «no hay nadie»: es «no hay ciclo». Ver el encabezado
  // de `rotacionDeLaSemana.ts` — asignar sigue andando igual.
  if (!franja.porTurno) {
    return (
      <div className="rounded-t-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
        Falta cargar la semana de referencia del taller, así que no se sabe quién va a qué turno.
        {franja.sinTurno.length > 0 && (
          <> En el taller esta semana: <Gente gente={franja.sinTurno} />.</>
        )}
      </div>
    );
  }

  const porTurno = franja.porTurno;

  return (
    <div className="rounded-t-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
        {TURNOS_DE_LA_FRANJA.map((turno) => (
          <div key={turno} className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-semibold text-slate-500">{turno}</span>
            {porTurno[turno].length === 0 ? (
              <span className="text-slate-400">nadie</span>
            ) : (
              <Gente gente={porTurno[turno]} />
            )}
          </div>
        ))}
      </div>

      {franja.sinTurno.length > 0 && (
        <p className="pt-1 text-slate-500">
          Sin turno del ciclo: <Gente gente={franja.sinTurno} />
        </p>
      )}

      {franja.diasConPisada > 0 && (
        <p className="pt-1 text-slate-400">
          {franja.diasConPisada === 1
            ? "1 día con gente movida de turno a mano."
            : `${franja.diasConPisada} días con gente movida de turno a mano.`}
        </p>
      )}
    </div>
  );
}

/**
 * Los nombres de un turno, con los que faltan algún día marcados.
 *
 * Dice **cuántos días** falta y nunca por qué: el motivo de una ausencia es
 * dato médico y disciplinario, y la ruta ni siquiera lo manda.
 */
function Gente({ gente }: { gente: FranjaDeLaSemana["sinTurno"] }) {
  return (
    <span className="text-slate-700">
      {gente.map((q, i) => (
        <span key={q.empleadoId}>
          {i > 0 && ", "}
          <span className={q.diasQueFalta.length > 0 ? "text-amber-700" : undefined}>
            {q.nombre}
            {q.diasQueFalta.length > 0 && (
              <span className="text-amber-600">
                {" "}
                ({q.diasQueFalta.length === 1 ? "falta 1 día" : `falta ${q.diasQueFalta.length} días`})
              </span>
            )}
          </span>
        </span>
      ))}
    </span>
  );
}
