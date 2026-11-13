"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { Modal } from "@/components/Modal";
import { useBorrador } from "@/lib/core/useBorrador";
import { claveDelBorrador } from "@/lib/core/borradorDeFormulario";
import { sumarDias } from "@/lib/core/fechas";
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
  alCorregir: (
    id: string,
    c: { tipo: string; fechaDesde: string; fechaHasta: string; observaciones: string | null }
  ) => Promise<string | null>;
  alBorrar: (a: AusenciaPropia) => Promise<string | null>;
  alMover: (empleadoId: string, dia: string, turno: Turno) => Promise<string | null>;
  alVolverAlCiclo: (empleadoId: string, dia: string) => Promise<string | null>;
}) {
  /*
   * LO QUE SE PUEDE DEJAR A MEDIO ESCRIBIR, Y QUIÉN LO DESCARTA
   *
   * La hoja tiene dos formularios chicos que conviven: «No viene este día»
   * —hasta, el panel de «Otra» y su motivo— y la corrección de la ausencia
   * propia —tipo, desde, hasta y observaciones—. Los dos entran en un solo
   * borrador porque los dos son la misma hoja de la misma persona el mismo día,
   * y la clave lleva las dos cosas: la hoja de otro día de la misma persona es
   * otro formulario.
   *
   * **La hoja no tiene botón negativo propio**, y por eso los que tira no la
   * cierran: cada panel descarta lo suyo con su «Cancelar», devolviendo sus
   * campos al valor con el que nacieron —y un campo que vuelve a su valor
   * inicial sale solo del borrador—. El de la corrección ya existía y sólo
   * plegaba; el de «Otra» se agregó para que ese panel también tenga quién lo
   * descarte, que es lo que la regla pide.
   */
  // Congelado en el primer render, igual que lo que el borrador guardó como
  // «cómo nació»: los «Cancelar» devuelven los campos a **estos** valores, y si
  // se recalcularan contra un `propia` que cambió abajo, cancelar dejaría en el
  // borrador un valor que ya no es el inicial y la hoja seguiría figurando
  // tocada. Es un `useState` que nadie actualiza y no un `useRef` porque se lee
  // durante el render (`react-hooks/refs`).
  const [INICIAL] = useState({
    hasta: dia,
    eligioOtra: false,
    motivo: "",
    corrigiendo: false,
    tipoNuevo: propia?.tipo ?? "ENFERMEDAD_ACCIDENTE_INCULPABLE",
    desdeNuevo: propia?.fecha_desde ?? dia,
    hastaNuevo: propia?.fecha_hasta ?? dia,
    motivoNuevo: propia?.observaciones ?? "",
  });
  const { valores, cambiar, tocado, tirar } = useBorrador(
    claveDelBorrador("mantenimiento-hoja-de-persona", {
      tipo: "persona-dia",
      id: `${persona.empleadoId}|${dia}`,
    }),
    INICIAL,
  );
  const {
    hasta, eligioOtra, motivo, corrigiendo, tipoNuevo, desdeNuevo, hastaNuevo, motivoNuevo,
  } = valores;

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guardar sin haber cambiado nada escribiría una fila de auditoría por un
  // no-op, y esa tabla no se borra nunca.
  const sinCambios =
    !propia ||
    (tipoNuevo === propia.tipo &&
      desdeNuevo === propia.fecha_desde &&
      hastaNuevo === propia.fecha_hasta &&
      (motivoNuevo.trim() || null) === ((propia.observaciones ?? "").trim() || null));

  /**
   * El último día que acepta la ruta: el rango tiene tope de 90 días contando
   * los dos extremos, así que el máximo es `desde + 89`. Va en el `max` del
   * campo y no sólo en la validación de la ruta porque un año mal tipeado era
   * un viaje de ida y vuelta para leer un 400 — la regla se ve donde se aplica.
   */
  const MAX_DIAS = 90;
  const topeDesde = (desde: string) => sumarDias(desde, MAX_DIAS - 1);

  /**
   * Corre una acción con los botones apagados y deja el error a la vista si falla.
   *
   * **`loCargado` no tiene valor por omisión a propósito**, y es lo que evita el
   * bug que tuvo esta hoja: con un `tirar()` al final de todas las acciones,
   * mover a alguien de turno —que no tiene nada que ver con los formularios—
   * borraba el motivo que se estaba escribiendo en el panel de «Otra», sin una
   * palabra. Los dos paneles comparten un solo borrador, así que cualquier
   * acción que lo tire se lleva lo que se esté escribiendo en el otro.
   *
   * `"se-tira"` es para las acciones que **son** el formulario —anotar la falta,
   * corregirla, sacarla—: lo que se cargó ya quedó guardado. `"se-queda"` es
   * para las que pasan al lado —mover de turno, volver al ciclo—, que cierran la
   * hoja igual, así que lo escrito vuelve a aparecer al reabrirla.
   *
   * Sin valor por omisión, la próxima acción que se agregue **no compila** hasta
   * contestar la pregunta, que es la única defensa que esto puede tener: ningún
   * test de este repo mira una pantalla.
   *
   * El borrador se tira sólo si salió bien, y no al apretar: un error deja la
   * hoja abierta y lo escrito tiene que seguir donde estaba.
   */
  async function hacer(
    accion: () => Promise<string | null>,
    loCargado: "se-tira" | "se-queda",
  ) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const e = await accion();
    setEnviando(false);
    if (e) { setError(e); return; }
    if (loCargado === "se-tira") tirar();
  }

  function anotar(tipo: string, obs: string | null) {
    if (hasta < dia) {
      setError("La fecha hasta no puede ser anterior al día de la falta");
      return;
    }
    void hacer(() => alAnotar(persona.empleadoId, dia, hasta, tipo, obs), "se-tira");
  }

  const turnoActual = asignacion?.turno;
  const oficio = falta?.oficio ?? persona.oficio;

  return (
    // No es un visor, aunque casi todo se anote con un toque: tiene el motivo de
    // «Otra», los tres campos de fecha y las observaciones de la corrección, que
    // se pueden dejar a medio escribir. Por eso va **sin** `soloLectura`, que es
    // la exclusión permanente de la pregunta al salir: el fondo, la X y Escape
    // salen conservando, y lo que se deje escrito aparece igual al volver a
    // abrir esta hoja. Quién lo descarta está arriba, en el comentario de
    // `INICIAL`: los «Cancelar» de los dos paneles, que son los únicos que tiran.
    <Modal titulo={persona.nombre} alSalir={alCerrar} tocado={tocado}>
      <div>
        <p className="-mt-2 mb-3 text-xs capitalize text-slate-500">
          {OFICIO_TEXTO[oficio]}
          {turnoActual && ` · ${TURNO_TEXTO[turnoActual]}`} · {diaLargo(dia)}
        </p>

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
                  max={topeDesde(dia)}
                  value={hasta}
                  onChange={(e) => cambiar({ hasta: e.target.value || dia })}
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
                    if (t.valor === "OTRA") cambiar({ eligioOtra: true });
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
                  onChange={(e) => cambiar({ motivo: e.target.value })}
                  className="input"
                />
                <div className="flex gap-2">
                  {/* El que tira lo de este panel: lo pliega y descarta el
                      motivo, devolviéndolo a como nació. Sin él, este panel
                      sería el único que pide conservar y no tiene con qué
                      descartar. */}
                  <button
                    type="button"
                    className="btn-secondary flex-1"
                    disabled={enviando}
                    onClick={() => cambiar({ eligioOtra: false, motivo: INICIAL.motivo })}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={enviando || !motivo.trim()}
                    onClick={() => anotar("OTRA", motivo.trim())}
                    className="btn-primary flex-1"
                  >
                    Anotar la falta
                  </button>
                </div>
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
                    <button type="button" className="btn-secondary flex-1" disabled={enviando} onClick={() => cambiar({ corrigiendo: true })}>
                      Corregir
                    </button>
                    <button type="button" className="btn-danger flex-1" disabled={enviando} onClick={() => void hacer(() => alBorrar(propia), "se-tira")}>
                      Sacar
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div>
                      <label htmlFor="corregir-tipo" className="mb-1 block text-xs text-slate-500">Tipo</label>
                      <Select id="corregir-tipo" className="input" value={tipoNuevo} onChange={(e) => cambiar({ tipoNuevo: e.target.value })}>
                        {TIPOS.map((t) => (
                          <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
                        ))}
                      </Select>
                    </div>
                    {/*
                      El desde se puede corregir: la ruta lo acepta desde
                      siempre y este formulario no lo ofrecía, así que una
                      ausencia anotada en el día equivocado había que borrarla
                      y volver a cargarla — y borrar escribe una fila de
                      auditoría que no se saca nunca.
                    */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label htmlFor="corregir-desde" className="mb-1 block text-xs text-slate-500">Desde</label>
                        <input
                          id="corregir-desde"
                          type="date"
                          max={hastaNuevo}
                          value={desdeNuevo}
                          onChange={(e) => cambiar({ desdeNuevo: e.target.value || propia.fecha_desde })}
                          className="input"
                        />
                      </div>
                      <div>
                        <label htmlFor="corregir-hasta" className="mb-1 block text-xs text-slate-500">Hasta</label>
                        <input
                          id="corregir-hasta"
                          type="date"
                          min={desdeNuevo}
                          max={topeDesde(desdeNuevo)}
                          value={hastaNuevo}
                          onChange={(e) => cambiar({ hastaNuevo: e.target.value || propia.fecha_hasta })}
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
                        onChange={(e) => cambiar({ motivoNuevo: e.target.value })}
                        className="input"
                      />
                    </div>
                    <div className="flex gap-2">
                      {/* El que tira lo de este panel: lo pliega y devuelve
                          los cuatro campos a lo que decía la ausencia. */}
                      <button
                        type="button"
                        className="btn-secondary flex-1"
                        disabled={enviando}
                        onClick={() => cambiar({
                          corrigiendo: false,
                          tipoNuevo: INICIAL.tipoNuevo,
                          desdeNuevo: INICIAL.desdeNuevo,
                          hastaNuevo: INICIAL.hastaNuevo,
                          motivoNuevo: INICIAL.motivoNuevo,
                        })}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn-primary flex-1"
                        disabled={enviando || sinCambios || (tipoNuevo === "OTRA" && !motivoNuevo.trim())}
                        onClick={() =>
                          void hacer(
                            () =>
                              alCorregir(propia.id, {
                                tipo: tipoNuevo,
                                fechaDesde: desdeNuevo,
                                fechaHasta: hastaNuevo,
                                observaciones: motivoNuevo.trim() || null,
                              }),
                            "se-tira",
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
                          onClick={() => void hacer(() => alMover(c, dia, falta.turno), "se-queda")}
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
                  onClick={() => void hacer(() => alMover(persona.empleadoId, dia, t), "se-queda")}
                >
                  {TURNO_TEXTO[t]}
                </button>
              ))}
              {asignacion?.pisada && (
                <button
                  type="button"
                  disabled={enviando}
                  className="btn-ghost"
                  onClick={() => void hacer(() => alVolverAlCiclo(persona.empleadoId, dia), "se-queda")}
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
            onClick={() => void hacer(() => alVolverAlCiclo(persona.empleadoId, dia), "se-queda")}
          >
            Volver al turno del ciclo
          </button>
        )}
      </div>
    </Modal>
  );
}

