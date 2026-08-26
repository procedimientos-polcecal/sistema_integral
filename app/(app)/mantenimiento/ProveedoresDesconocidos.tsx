"use client";

import { useMemo, useState } from "react";
import { nombresParecidos } from "@/lib/core/proveedores";

/**
 * Los proveedores que aparecen en la planilla y no están en el sistema.
 *
 * La sincronización no los crea sola: `proveedores` es la lista que Compras usa
 * todos los días, y llenarla con cada variante que alguien tipeó en una
 * planilla la vuelve inservible. Se muestran acá para que alguien decida.
 *
 * Antes de sumarlos se avisa cuáles parecen el mismo escrito de dos formas
 * —"Cortadi" y "Domingo Cortadi"—, que es el momento de unificarlos: después
 * hay que fusionar dos fichas.
 */
export default function ProveedoresDesconocidos({
  nombres, puedeEditar, onSumados,
}: {
  nombres: string[];
  puedeEditar: boolean;
  onSumados: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");

  const parecidos = useMemo(() => nombresParecidos(nombres), [nombres]);

  if (nombres.length === 0) return null;

  async function sumar() {
    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/proveedores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombres }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudieron sumar."); return; }

    setListo(
      [
        body.creados > 0 && `Se sumaron ${body.creados}.`,
        body.marcados > 0 && `${body.marcados} ya estaban y quedaron marcados como contratistas.`,
      ].filter(Boolean).join(" ")
    );
    onSumados();
  }

  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p>
        <span className="font-semibold">
          {nombres.length} proveedor{nombres.length === 1 ? "" : "es"} de la planilla
        </span>{" "}
        no está{nombres.length === 1 ? "" : "n"} en el sistema, así que el trabajo quedó sin enlazar.
      </p>

      <p className="text-xs">{nombres.slice(0, 25).join(" · ")}{nombres.length > 25 && " …"}</p>

      {parecidos.length > 0 && (
        <div className="rounded-lg bg-white/60 px-3 py-2 text-xs">
          <p className="font-semibold">Estos parecen el mismo escrito de dos formas:</p>
          <ul className="mt-0.5 space-y-0.5">
            {parecidos.map((grupo) => (
              <li key={grupo[0]}>· {grupo.join("  =  ")}</li>
            ))}
          </ul>
          <p className="mt-1 text-amber-700">
            Conviene dejar uno solo en la planilla antes de sumarlos: después hay que fusionar
            dos fichas.
          </p>
        </div>
      )}

      {error && <p className="text-red-700">{error}</p>}
      {listo ? (
        <p className="font-semibold">{listo}</p>
      ) : (
        puedeEditar && (
          <button
            onClick={sumar}
            disabled={guardando}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {guardando ? "Sumando…" : "Sumarlos como contratistas"}
          </button>
        )
      )}
    </div>
  );
}
