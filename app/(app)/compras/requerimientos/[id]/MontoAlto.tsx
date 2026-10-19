"use client";

import { moneda } from "@/lib/compras/constants";
import type { MarcaManual } from "@/lib/compras/montoAlto";
import { lecturaDeMontoAlto, POSICIONES_DE_MONTO_ALTO } from "@/lib/compras/montoAltoPantalla";

/**
 * Qué dice la ficha sobre si este requerimiento es de monto alto, y por qué.
 *
 * Muestra las dos mitades y cuál mandó. Un RI de 29 millones que figura como
 * «No es monto alto» porque alguien lo desmarcó tiene que **poder leerse así**:
 * si la pantalla sólo dijera «No es monto alto» junto a un monto enorme,
 * parecería un error del sistema y la próxima persona lo volvería a marcar.
 *
 * El control de tres posiciones manda `monto_alto_manual` como `null`
 * (automático), `true` o `false`. Las dos últimas le ganan al monto en los dos
 * sentidos, y por eso hay que dejar claro cuál está puesta.
 */
export default function MontoAlto({
  montoConocido, manual, umbral, origenDelMonto, puedeMarcar, guardando, onCambiar,
}: {
  montoConocido: number | null;
  manual: MarcaManual;
  umbral: number;
  /** De dónde sale el monto: el costo si ya se compró, si no el presupuesto más alto. */
  origenDelMonto: string;
  /** Si quien mira puede cambiar la marca. */
  puedeMarcar: boolean;
  guardando: boolean;
  onCambiar: (valor: MarcaManual) => void;
}) {
  const lectura = lecturaDeMontoAlto(montoConocido, manual, umbral);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Monto alto</h2>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            lectura.alto ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
          }`}
        >
          {lectura.titulo}
        </span>
        <span className="text-sm text-slate-600">
          {lectura.esManual ? "Decisión de una persona: " : "Por el monto: "}
          {lectura.porque}
        </span>
      </div>

      <dl className="mt-3 space-y-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Monto que se sabe
          </dt>
          <dd className={`text-sm ${montoConocido === null ? "text-slate-400" : "font-mono text-slate-900"}`}>
            {montoConocido === null ? "Todavía no hay ninguno" : moneda(montoConocido)}
          </dd>
          {montoConocido !== null && (
            <dd className="text-xs text-slate-500">{origenDelMonto}</dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Se considera alto desde
          </dt>
          <dd className="font-mono text-sm text-slate-900">{moneda(umbral)}</dd>
        </div>
      </dl>

      {puedeMarcar && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div
            role="group"
            aria-label="Marca de monto alto"
            className="flex overflow-hidden rounded-lg border border-slate-300"
          >
            {POSICIONES_DE_MONTO_ALTO.map((p) => {
              const puesta = p.valor === manual;
              return (
                <button
                  key={String(p.valor)}
                  type="button"
                  aria-pressed={puesta}
                  disabled={guardando}
                  onClick={() => { if (!puesta) onCambiar(p.valor); }}
                  className={`flex-1 border-l border-slate-300 px-2 py-2 text-xs font-semibold first:border-l-0 disabled:opacity-50 ${
                    puesta
                      ? "bg-[var(--primary)] text-white"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {p.texto}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            <strong>Automático</strong> decide por el monto. <strong>Es alto</strong> y{" "}
            <strong>No es alto</strong> le ganan al monto, en los dos sentidos: sirven para
            marcar uno que todavía no tiene número, o para sacar una compra grande pero
            rutinaria.
          </p>
        </div>
      )}
    </section>
  );
}
