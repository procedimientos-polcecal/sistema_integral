"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moneda } from "@/lib/compras/constants";

/**
 * A partir de cuánto un requerimiento es de monto alto.
 *
 * Lo ve todo el que entra a la configuración, porque explica por qué unos RI
 * aparecen marcados y otros no; lo edita quien administra el módulo, que es
 * quien puede escribir en `compras_ajustes`. A los demás no se les ofrece un
 * campo que la base iba a rechazar.
 *
 * Cambiarlo **no recalcula nada**: la base guarda el monto de cada RI y no un
 * «es alto», así que el nuevo umbral cambia la pregunta, no las respuestas ya
 * guardadas. El listado y las fichas lo toman en la próxima carga.
 */
export default function UmbralDeMontoAlto({
  umbral, puedeEditar,
}: {
  umbral: number;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(String(umbral));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [guardado, setGuardado] = useState(false);

  const numero = Number(valor);
  const cambio = valor.trim() !== "" && numero !== umbral;

  async function guardar() {
    setGuardando(true);
    setError("");
    setGuardado(false);

    const res = await fetch("/api/compras/ajustes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ umbral_monto_alto: numero }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar el umbral.");
      return;
    }
    setGuardado(true);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Umbral de monto alto
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        Un requerimiento se marca como <strong>monto alto</strong> cuando lo que se sabe de su
        monto —el costo si ya se compró, y si no el presupuesto más alto— llega a{" "}
        <strong className="font-mono">{moneda(umbral)}</strong>. Una persona puede marcar o
        desmarcar uno a mano desde su ficha, y eso le gana al monto.
      </p>

      {puedeEditar ? (
        <div className="space-y-2">
          <label className="block max-w-xs">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Nuevo umbral, en pesos
            </span>
            <input
              type="number" min="1" step="1" inputMode="numeric"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={valor}
              onChange={(e) => { setValor(e.target.value); setGuardado(false); }}
            />
          </label>

          <button
            onClick={guardar}
            disabled={guardando || !cambio}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar umbral"}
          </button>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          {guardado && (
            <p className="text-sm text-green-700">
              Guardado. No recalcula nada: los requerimientos cambian de marca al volver a
              cargar el listado.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Lo cambia un administrador del módulo.
        </p>
      )}
    </section>
  );
}
