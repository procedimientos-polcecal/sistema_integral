"use client";

import { useState } from "react";
import Select from "@/components/Select";
import type { Turno } from "@/lib/mantenimiento/programacion";
import {
  TIPOS, TURNOS, TURNO_TEXTO, OFICIO_TEXTO,
  diaLargo, rangoComoSeLee, tipoTexto,
  type Asignacion, type Ausente, type AusenciaPropia, type Persona,
} from "./programacionComun";

// ── La hoja de una persona ───────────────────────────────────

export default function HojaDePersona({
  persona, dia, asignacion, falta, propia, seSabeLoPropio, candidatos, turnoDe, nombreDe,
  alCerrar, alAnotar, alCorregir, alBorrar, alMover, alVolverAlCiclo,
}: {
  persona: Persona;
  dia: string;
  asignacion?: Asignacion;
  falta?: Ausente;
  propia?: AusenciaPropia;
  /**
   * Si se pudo traer lo que cargó el encargado. Sin esto, "no hay una propia"
   * quiere decir dos cosas: que la falta la cargó otro, o que la lista no llegó.
   * La pantalla no puede afirmar lo primero cuando pasó lo segundo.
   */
  seSabeLoPropio: boolean;
  candidatos: string[];
  turnoDe: (id: string) => Turno | undefined;
  nombreDe: (id: string) => string;
  alCerrar: () => void;
  alAnotar: (empleadoId: string, desde: string, hasta: string, tipo: string, obs: string | null) => Promise<string | null>;
  alCorregir: (id: string, c: { tipo: string; fechaHasta: string; observaciones: string | null }) => Promise<string | null>;
  alBorrar: (a: AusenciaPropia) => Promise<string | null>;
  alMover: (empleadoId: string, dia: string, turno: Turno) => Promise<string | null>;
  alVolverAlCiclo: (empleadoId: string, dia: string) => Promise<string | null>;
}) {
  const [hasta, setHasta] = useState(dia);
  const [eligioOtra, setEligioOtra] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [tipoNuevo, setTipoNuevo] = useState(propia?.tipo ?? "ENFERMEDAD_ACCIDENTE_INCULPABLE");
  const [hastaNuevo, setHastaNuevo] = useState(propia?.fecha_hasta ?? dia);
  const [motivoNuevo, setMotivoNuevo] = useState(propia?.observaciones ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guardar sin haber cambiado nada escribiría una fila de auditoría por un
  // no-op, y esa tabla no se borra nunca.
  const sinCambios =
    !propia ||
    (tipoNuevo === propia.tipo &&
      hastaNuevo === propia.fecha_hasta &&
      (motivoNuevo.trim() || null) === ((propia.observaciones ?? "").trim() || null));

  /** Corre una acción con los botones apagados y deja el error a la vista si falla. */
  async function hacer(accion: () => Promise<string | null>) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const e = await accion();
    setEnviando(false);
    if (e) setError(e);
  }

  function anotar(tipo: string, obs: string | null) {
    if (hasta < dia) {
      setError("La fecha hasta no puede ser anterior al día de la falta");
      return;
    }
    void hacer(() => alAnotar(persona.empleadoId, dia, hasta, tipo, obs));
  }

  const turnoActual = asignacion?.turno;
  const oficio = falta?.oficio ?? persona.oficio;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center"
      onClick={alCerrar}
    >
      <div
        role="dialog"
        aria-label={`Ausencia de ${persona.nombre}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{persona.nombre}</h2>
            <p className="text-xs capitalize text-slate-500">
              {OFICIO_TEXTO[oficio]}
              {turnoActual && ` · ${TURNO_TEXTO[turnoActual]}`} · {diaLargo(dia)}
            </p>
          </div>
          <button type="button" className="shrink-0 px-2 text-2xl leading-none text-slate-500" aria-label="Cerrar" onClick={alCerrar}>
            ×
          </button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        {/* ── No figura ausente: acá se anota. Un toque en el tipo y queda. ── */}
        {asignacion && !falta && (
          <section className="mb-4">
            <h3 className="mb-1.5 text-sm font-semibold text-slate-800">No viene este día</h3>

            <div className="mb-2 flex items-center gap-2 text-sm text-slate-600">
              <label htmlFor="ausencia-hasta" className="shrink-0">
                Hasta
              </label>
              <div className="w-40">
                <input
                  id="ausencia-hasta"
                  type="date"
                  min={dia}
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value || dia)}
                  className="input"
                />
              </div>
              {hasta === dia && <span className="text-xs text-slate-400">sólo este día</span>}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TIPOS.map((t) => (
                <button
                  key={t.valor}
                  type="button"
                  disabled={enviando}
                  onClick={() => {
                    // "Otra" no se puede anotar sin motivo: la ruta contesta 400.
                    // Los otros tres quedan anotados con este mismo toque.
                    if (t.valor === "OTRA") setEligioOtra(true);
                    else anotar(t.valor, null);
                  }}
                  className={`min-h-[48px] rounded-lg border px-3 py-2 text-sm font-medium ${
                    t.valor === "OTRA" && eligioOtra
                      ? "border-[var(--primary)] bg-[var(--primary-light)]"
                      : "border-slate-300 bg-white"
                  } disabled:opacity-50`}
                >
                  {t.etiqueta}
                  {t.valor === "OTRA" ? "…" : ""}
                </button>
              ))}
            </div>

            {eligioOtra && (
              <div className="mt-2 space-y-2">
                <label htmlFor="ausencia-motivo" className="block text-xs text-slate-500">
                  Qué pasó (hace falta para anotar &ldquo;Otra&rdquo;)
                </label>
                <textarea
                  id="ausencia-motivo"
                  autoFocus
                  rows={2}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  className="input"
                />
                <button
                  type="button"
                  disabled={enviando || !motivo.trim()}
                  onClick={() => anotar("OTRA", motivo.trim())}
                  className="btn-primary w-full"
                >
                  Anotar la falta
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Ya figura ausente ── */}
        {falta && (
          <section className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-red-800">Figura ausente este día</h3>

            {propia ? (
              <>
                <p className="mb-2 text-sm text-slate-700">
                  La anotaste vos: {tipoTexto(propia.tipo).toLowerCase()},{" "}
                  {rangoComoSeLee(propia.fecha_desde, propia.fecha_hasta)}
                  {propia.observaciones ? ` — ${propia.observaciones}` : ""}.
                </p>

                {!corrigiendo ? (
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary flex-1" disabled={enviando} onClick={() => setCorrigiendo(true)}>
                      Corregir
                    </button>
                    <button type="button" className="btn-danger flex-1" disabled={enviando} onClick={() => void hacer(() => alBorrar(propia))}>
                      Sacar
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div>
                      <label htmlFor="corregir-tipo" className="mb-1 block text-xs text-slate-500">Tipo</label>
                      <Select id="corregir-tipo" className="input" value={tipoNuevo} onChange={(e) => setTipoNuevo(e.target.value)}>
                        {TIPOS.map((t) => (
                          <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label htmlFor="corregir-hasta" className="mb-1 block text-xs text-slate-500">Hasta</label>
                      <div className="w-40">
                        <input
                          id="corregir-hasta"
                          type="date"
                          min={propia.fecha_desde}
                          value={hastaNuevo}
                          onChange={(e) => setHastaNuevo(e.target.value || propia.fecha_hasta)}
                          className="input"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="corregir-motivo" className="mb-1 block text-xs text-slate-500">
                        Observaciones{tipoNuevo === "OTRA" ? " (obligatorias para “Otra”)" : ""}
                      </label>
                      <textarea
                        id="corregir-motivo"
                        rows={2}
                        value={motivoNuevo}
                        onChange={(e) => setMotivoNuevo(e.target.value)}
                        className="input"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary flex-1" disabled={enviando} onClick={() => setCorrigiendo(false)}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn-primary flex-1"
                        disabled={enviando || sinCambios || (tipoNuevo === "OTRA" && !motivoNuevo.trim())}
                        onClick={() =>
                          void hacer(() =>
                            alCorregir(propia.id, {
                              tipo: tipoNuevo,
                              fechaHasta: hastaNuevo,
                              observaciones: motivoNuevo.trim() || null,
                            })
                          )
                        }
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-600">
                {seSabeLoPropio
                  ? "Esta falta no figura entre las que cargaste vos: la cargó RRHH u otra persona. Desde acá no se ve el motivo ni se puede tocar."
                  : "No se pudo traer lo que cargaste vos, así que desde acá no se puede corregir. Desde acá tampoco se ve el motivo."}
              </p>
            )}

            {/* Quién puede tapar el hueco. */}
            <div className="mt-3">
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Quién puede taparlo</h3>
              {candidatos.length === 0 ? (
                <p className="text-sm text-slate-500">Nadie libre del mismo oficio ese día.</p>
              ) : (
                <ul className="space-y-1.5">
                  {candidatos.map((c) => {
                    const t = turnoDe(c);
                    return (
                      <li key={c} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                        <span className="min-w-0 text-sm">
                          <span className="block truncate font-medium text-slate-900">{nombreDe(c)}</span>
                          {t && <span className="text-xs text-slate-500">hoy en {TURNO_TEXTO[t]}</span>}
                        </span>
                        <button
                          type="button"
                          disabled={enviando}
                          className="btn-secondary shrink-0"
                          onClick={() => void hacer(() => alMover(c, dia, falta.turno))}
                        >
                          Pasar a {TURNO_TEXTO[falta.turno]}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* ── Moverlo de turno: sólo si no falta, y es la salida para los que no tienen turno. ── */}
        {!falta && (
          <section>
            <h3 className="mb-1.5 text-sm font-semibold text-slate-800">
              {asignacion ? "Moverlo de turno este día" : "Asignarle turno este día"}
            </h3>
            {asignacion?.pisada && (
              <p className="mb-2 text-xs text-amber-800">Ya está movido a mano; el resto de los días sigue el ciclo.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {TURNOS.filter((t) => t !== turnoActual).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={enviando}
                  className="btn-secondary"
                  onClick={() => void hacer(() => alMover(persona.empleadoId, dia, t))}
                >
                  {TURNO_TEXTO[t]}
                </button>
              ))}
              {asignacion?.pisada && (
                <button
                  type="button"
                  disabled={enviando}
                  className="btn-ghost"
                  onClick={() => void hacer(() => alVolverAlCiclo(persona.empleadoId, dia))}
                >
                  Volver al ciclo
                </button>
              )}
            </div>
          </section>
        )}

        {/* Si falta y además está movido, la pisada se saca igual. */}
        {falta && asignacion?.pisada && (
          <button
            type="button"
            disabled={enviando}
            className="btn-ghost mt-2"
            onClick={() => void hacer(() => alVolverAlCiclo(persona.empleadoId, dia))}
          >
            Volver al turno del ciclo
          </button>
        )}
      </div>
    </div>
  );
}

