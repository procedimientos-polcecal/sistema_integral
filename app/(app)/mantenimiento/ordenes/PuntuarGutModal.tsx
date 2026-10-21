"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { ESCALAS_GUT, puntajeGut } from "@/lib/mantenimiento/gut";
import PuntajeGut from "./PuntajeGut";

/**
 * Puntuar con GUT una orden que ya existe.
 *
 * Es el camino que más se usa: de las 2.227 órdenes, 2.209 entraron por el
 * formulario de Google y llegaron sin puntaje, así que casi todo el GUT se
 * carga acá y no al crear la orden. El diseño está en
 * docs/superpowers/specs/2026-10-21-mantenimiento-gut-design.md.
 *
 * Se abre con las notas que la orden ya tiene —puntuar de nuevo es corregir, no
 * empezar de cero— y deja dejarlas todas vacías: un puntaje no es irreversible,
 * se corrige escribiendo otro, y por eso borrarlo también tiene que poder.
 *
 * El modal no es dueño del listado: guarda, avisa con `onGuardada` y quien lo
 * abrió decide cómo se refresca.
 */

const CAMPOS = [
  ["gut_gravedad", "Gravedad", ESCALAS_GUT.gravedad],
  ["gut_urgencia", "Urgencia", ESCALAS_GUT.urgencia],
  ["gut_tendencia", "Tendencia", ESCALAS_GUT.tendencia],
] as const;

type Campo = (typeof CAMPOS)[number][0];
type Notas = Record<Campo, string>;

/** Lo que el desplegable maneja es texto; la base guarda un entero o nada. */
const aTexto = (n: number | null | undefined) => (n == null ? "" : String(n));
const aNota = (t: string) => (t === "" ? null : Number(t));

export default function PuntuarGutModal({
  orden, onCerrar, onGuardada,
}: {
  orden: {
    id: string;
    ot_number: number | null;
    equipo_raw: string | null;
    descripcion: string | null;
    gut_gravedad?: number | null;
    gut_urgencia?: number | null;
    gut_tendencia?: number | null;
  };
  onCerrar: () => void;
  onGuardada: () => void;
}) {
  const inicial: Notas = {
    gut_gravedad: aTexto(orden.gut_gravedad),
    gut_urgencia: aTexto(orden.gut_urgencia),
    gut_tendencia: aTexto(orden.gut_tendencia),
  };
  const [notas, setNotas] = useState<Notas>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const elegidas = {
    gut_gravedad: aNota(notas.gut_gravedad),
    gut_urgencia: aNota(notas.gut_urgencia),
    gut_tendencia: aNota(notas.gut_tendencia),
  };
  const puntaje = puntajeGut(elegidas);
  const cuantas = CAMPOS.filter(([campo]) => notas[campo] !== "").length;
  const cambio = CAMPOS.some(([campo]) => notas[campo] !== inicial[campo]);

  function elegir(campo: Campo, valor: string) {
    setNotas((n) => ({ ...n, [campo]: valor }));
    setError("");
  }

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      // Las tres siempre, con `null` en las vacías: la ruta deja como está la
      // nota que no viene, y lo que se ve en pantalla tiene que ser lo que
      // queda guardado, también cuando se vacía una.
      const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/gut`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(elegidas),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "No se pudo guardar el puntaje.");
        return;
      }
      onGuardada();
    } catch {
      setError("No se pudo guardar el puntaje: no hubo conexión con el servidor.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-slate-900">Puntaje GUT · OT #{orden.ot_number ?? "—"}</h2>
          <p className="mt-0.5 truncate text-xs text-slate-400">{orden.equipo_raw ?? orden.descripcion ?? ""}</p>
        </div>

        <div className="space-y-3">
          {CAMPOS.map(([campo, etiqueta, escala]) => (
            <div key={campo} className="space-y-1">
              <label className="block text-xs font-medium text-slate-600">{etiqueta}</label>
              <Select
                value={notas[campo]}
                onChange={(e) => elegir(campo, e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {escala.map((palabra, i) => (
                  <option key={i + 1} value={String(i + 1)}>{i + 1} · {palabra}</option>
                ))}
              </Select>
            </div>
          ))}
        </div>

        {/* El número que producen las tres elecciones, a la vista antes de
            guardar. Es el mismo recuadro del listado, así que se ve exactamente
            como va a quedar en la fila. */}
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <PuntajeGut orden={elegidas} />
          <p className="text-xs text-slate-600">
            {puntaje !== null
              ? <>{elegidas.gut_gravedad} × {elegidas.gut_urgencia} × {elegidas.gut_tendencia} = <b>{puntaje}</b> de 125</>
              : cuantas === 0
                ? "Sin puntaje: elegí las tres notas."
                : `${3 - cuantas === 1 ? "Falta 1 nota" : "Faltan 2 notas"}: con menos de tres se guarda, pero la orden sigue sin puntaje.`}
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={guardar}
            disabled={guardando || !cambio}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <button
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
