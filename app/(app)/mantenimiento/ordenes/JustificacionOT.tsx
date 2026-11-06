"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { haceCuanto } from "@/lib/core/haceCuanto";
import { MAXIMO_DE_NOTA } from "@/lib/mantenimiento/notas";

/**
 * Por qué una orden todavía no se hizo.
 *
 * Es el otro lado de la observación que ya existía: aquélla se completa **al
 * realizar** el trabajo —qué se encontró— y ésta explica por qué sigue abierta.
 * Por eso el bloque sólo aparece en las que no están realizadas.
 *
 * Se muestran todas y no sólo la última. Una OT atrasada se vuelve a justificar
 * con el tiempo, y leer "falta el repuesto" de hace dos meses arriba de
 * "esperamos la parada de planta" de ayer dice algo que ninguna de las dos dice
 * sola: que se viene postergando.
 *
 * El "hace cuánto" va al lado de cada una por lo mismo. Una justificación de
 * ayer y una de hace tres meses se leen igual sin eso, y no valen lo mismo.
 */

interface Nota {
  id: string;
  texto: string;
  creado_en: string;
  creado_por: string | null;
  autor: { nombre: string } | null;
}

export default function JustificacionOT({
  ordenId, puedeEditar, onCambio,
}: {
  ordenId: string;
  puedeEditar: boolean;
  /** Para que el listado refresque el cartel de "sin justificar". */
  onCambio?: () => void;
}) {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [cargando, setCargando] = useState(true);

  // `cargando` arranca en true y sólo baja: no se vuelve a subir al recargar.
  // Un "Buscando…" parpadeando sobre una lista que ya está es ruido, y además
  // subirlo desde el efecto es lo que el lint marca.
  const recargar = useCargar(async (vigente) => {
    const res = await fetch(`/api/mantenimiento/ordenes/${ordenId}/notas`);
    const body = await res.json().catch(() => ({}));
    if (!vigente()) return;
    setNotas(res.ok ? body.data ?? [] : []);
    setCargando(false);
  }, [ordenId]);

  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  async function agregar() {
    const limpio = texto.trim();
    if (!limpio) {
      setError("Escribí por qué no se hizo.");
      return;
    }
    setGuardando(true);
    setError("");
    setAviso("");

    const res = await fetch(`/api/mantenimiento/ordenes/${ordenId}/notas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: limpio }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar la justificación.");
      return;
    }

    setTexto("");
    // Guardó en el sistema; si no llegó a la planilla hay que decirlo, con lo
    // que dijo Google y sin traducir. Que la nota esté acá y no allá es una
    // divergencia, y una divergencia que nadie ve es la que muerde.
    if (body.planilla_error) {
      setAviso(`Quedó guardada, pero no llegó a la planilla: ${body.planilla_error}`);
    }
    recargar();
    onCambio?.();
  }

  async function borrar(nota: Nota) {
    setError("");
    setAviso("");
    const res = await fetch(
      `/api/mantenimiento/ordenes/${ordenId}/notas?nota=${nota.id}`, { method: "DELETE" }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No se pudo borrar.");
      return;
    }
    if (body.planilla_error) {
      setAviso(`Se borró, pero la planilla quedó como estaba: ${body.planilla_error}`);
    }
    recargar();
    onCambio?.();
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-500">Por qué no se hizo</p>

      {cargando && <p className="text-xs text-slate-400">Buscando…</p>}

      {!cargando && notas.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Sin justificar. Esta orden sigue abierta y nadie dejó dicho por qué.
        </p>
      )}

      {notas.length > 0 && (
        <ul className="space-y-1.5">
          {notas.map((n) => (
            <li key={n.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.texto}</p>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                <span>
                  {n.autor?.nombre ?? "—"} · <span title={new Date(n.creado_en).toLocaleString("es-AR")}>
                    {haceCuanto(n.creado_en)}
                  </span>
                </span>
                {/* Sólo la propia, igual que la policy. El botón aparece para
                    todos los que pueden editar y el servidor es el que decide:
                    esconderlo según el usuario acá sería repetir la regla en un
                    segundo lugar, que es donde se desincronizan. */}
                {puedeEditar && (
                  <button
                    onClick={() => borrar(n)}
                    className="text-slate-300 underline hover:text-red-600"
                  >
                    Borrar
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {puedeEditar && (
        <div className="flex items-start gap-2">
          <textarea
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setError(""); }}
            maxLength={MAXIMO_DE_NOTA}
            rows={2}
            placeholder="Por qué todavía no se hizo…"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
          <button
            onClick={agregar}
            disabled={guardando}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Agregar"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-amber-700">{aviso}</p>}
    </div>
  );
}
