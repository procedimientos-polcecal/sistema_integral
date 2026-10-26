"use client";

import { useState } from "react";
import Select from "@/components/Select";
import type { Grupo, Oficio } from "@/lib/mantenimiento/programacion";
import { OFICIO_TEXTO, diaMes, llamar, type Persona } from "./programacionComun";

/**
 * Sin la semana de referencia no hay ciclo que calcular: no se puede saber qué
 * grupo está en 4 a 12 ni dónde está cada electricista. Se dice, se muestra a
 * quién tiene el taller, y se ofrece cargarla —en vez de dibujar una grilla
 * vacía que parece una semana sin gente.
 *
 * La referencia es **la semana en curso y no la que se esté mirando**: quien
 * pasó dos semanas hacia adelante y recién entonces la carga estaría diciendo
 * cómo es una semana que todavía no pasó. Como el ciclo se cuenta hacia atrás y
 * hacia adelante, ancharla en esta semana sirve para mirar cualquiera.
 *
 * Se escribe por `POST /api/mantenimiento/programacion/referencia`, que valida
 * que los tres sean electricistas del taller, rechaza un segundo lunes igual y
 * deja el registro de auditoría. Esta pantalla no toca la base.
 */
export default function SinReferencia({
  lunes, personas, alCargar,
}: {
  /** El lunes de la semana en curso. */
  lunes: string;
  personas: Persona[];
  alCargar: () => void;
}) {
  const electricistas = personas.filter((p) => p.oficio === "electricista");
  const [grupo, setGrupo] = useState<Grupo>("A");
  const [e412, setE412] = useState("");
  const [e816, setE816] = useState("");
  const [e1220, setE1220] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    // Esto es sólo para no hacer ir y volver a la ruta por algo que se ve acá:
    // la que defiende es la ruta.
    const elegidos = [e412, e816, e1220];
    if (elegidos.some((e) => !e)) {
      setError("Falta elegir el electricista de cada turno");
      return;
    }
    if (new Set(elegidos).size !== 3) {
      setError("Cada turno lleva un electricista distinto");
      return;
    }
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const r = await llamar("/api/mantenimiento/programacion/referencia", "POST", {
      lunes,
      grupoEn4a12: grupo,
      electricista4a12Id: e412,
      electricista8a16Id: e816,
      electricista12a20Id: e1220,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    alCargar();
  }

  const porOficio = (o: Oficio) => personas.filter((p) => p.oficio === o);

  return (
    <div className="space-y-3">
      <div className="card border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">Falta cargar la semana de referencia</h2>
        <p className="mt-1 text-sm text-amber-900">
          Sin ella no se sabe qué grupo está en cada turno ni dónde está cada electricista, y no se puede armar la
          semana. Decí cómo está la semana en curso (la del {diaMes(lunes)}) y desde ahí se calculan todas las demás.
        </p>
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">
          El taller tiene {personas.length} {personas.length === 1 ? "persona" : "personas"} en la semana que se mira
        </h2>
        {personas.length === 0 ? (
          <p className="text-sm text-slate-500">
            No hay nadie del taller vigente en esta semana. Cargá el padrón (abajo, en &ldquo;El taller&rdquo;)
            antes de armar la referencia.
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-700">
            {(["mecanico", "lubricador", "electricista"] as Oficio[]).map((o) =>
              porOficio(o).length === 0 ? null : (
                <li key={o}>
                  <span className="font-medium">{OFICIO_TEXTO[o]}s:</span>{" "}
                  {porOficio(o).map((p) => `${p.nombre}${p.grupo ? ` (${p.grupo})` : ""}`).join(", ")}
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {electricistas.length >= 3 && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-800">La semana del {diaMes(lunes)}</h2>
          <div>
            <label htmlFor="ref-grupo" className="mb-1 block text-xs text-slate-500">Grupo que está en 4 a 12</label>
            <Select id="ref-grupo" className="input" value={grupo} onChange={(e) => setGrupo(e.target.value as Grupo)}>
              <option value="A">Grupo A</option>
              <option value="B">Grupo B</option>
            </Select>
          </div>
          {([
            ["ref-e412", "Electricista de 4 a 12", e412, setE412],
            ["ref-e816", "Electricista de 8 a 16", e816, setE816],
            ["ref-e1220", "Electricista de 12 a 20", e1220, setE1220],
          ] as const).map(([id, rotulo, valor, poner]) => (
            <div key={id}>
              <label htmlFor={id} className="mb-1 block text-xs text-slate-500">{rotulo}</label>
              <Select id={id} className="input" value={valor} onChange={(e) => poner(e.target.value)}>
                <option value="">Elegir…</option>
                {electricistas.map((p) => (
                  <option key={p.empleadoId} value={p.empleadoId}>{p.nombre}</option>
                ))}
              </Select>
            </div>
          ))}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <button type="button" className="btn-primary w-full" disabled={enviando} onClick={() => void guardar()}>
            Cargar la referencia
          </button>
        </div>
      )}

      {personas.length > 0 && electricistas.length < 3 && (
        <p className="text-sm text-slate-500">
          La referencia pide tres electricistas, y el padrón tiene {electricistas.length} en esta semana.
        </p>
      )}
    </div>
  );
}
