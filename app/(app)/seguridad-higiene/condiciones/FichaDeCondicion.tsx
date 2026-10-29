"use client";

import { useState, type ReactNode } from "react";
import Select from "@/components/Select";
import { useCargar } from "@/lib/core/useCargar";
import { comoSeLee } from "@/lib/core/fechas";
import { CRITERIOS, clasificar, type Criterio } from "@/lib/seguridadHigiene/riesgo";
import { estadoDe } from "@/lib/seguridadHigiene/condicion";
import {
  borradorDe,
  faltasPendientes,
  cambiosDe,
  nivelDeRiesgo,
  type Borrador,
  type FilaDeCondicion,
} from "@/lib/seguridadHigiene/gestion";
import { InsigniaDeClasificacion, InsigniaDeEstado, InsigniaDeFalta } from "./Insignias";

export interface Catalogos {
  sectores: { id: string; nombre: string; activo: boolean }[];
  equipos: { id: string; nombre: string; sector_id: string | null; activo: boolean }[];
  peligros: { id: string; nombre: string; activo: boolean }[];
  usuarios: { id: string; nombre: string; activo: boolean }[];
}

interface Foto {
  id: string;
  subida_el: string;
  link: string | null;
  descarga: string | null;
  error: string | null;
}

const CRITERIOS_EN_ORDEN: { clave: Criterio; titulo: string }[] = [
  { clave: "frecuencia", titulo: "Frecuencia" },
  { clave: "antecedentes", titulo: "Antecedentes" },
  { clave: "controles", titulo: "Controles" },
  { clave: "magnitud_dano", titulo: "Magnitud del daño" },
  { clave: "legislacion", titulo: "Legislación" },
];

/**
 * El texto de una opción cabe en el desplegable recortado; entero va debajo, en
 * cuanto se la elige. Los párrafos de «magnitud del daño» miden 300 caracteres:
 * en la lista de un navegador de escritorio salen más anchos que la pantalla.
 */
function recortado(texto: string, largo = 90): string {
  return texto.length <= largo ? texto : `${texto.slice(0, largo).trimEnd()}…`;
}

/** Los campos de una ficha son siempre etiqueta arriba, campo abajo. */
function Campo({ titulo, children, ayuda }: { titulo: string; children: ReactNode; ayuda?: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {titulo}
      </span>
      {children}
      {ayuda && <div className="text-xs text-slate-500">{ayuda}</div>}
    </div>
  );
}

/** Lo que se ve cuando el campo no se puede editar. */
function Valor({ children }: { children: ReactNode }) {
  return <p className="whitespace-pre-wrap text-sm text-slate-900">{children || "—"}</p>;
}

/**
 * La ficha de una condición: sus fotos y sus tres etapas.
 *
 *   1. Lo que cargó el teléfono (lugar, qué se vio, peligro, acción, prioridad).
 *      Lo corrige `edicion` mientras la condición no esté cerrada.
 *   2. La evaluación del riesgo. La completa `admin`.
 *   3. La gestión: responsable, plazo, inversión, observaciones y el cierre.
 *      También de `admin`.
 *
 * Quien no puede editar una sección la ve igual, como texto: la ficha es
 * también la forma de leer una condición.
 *
 * **Al guardar sólo se manda lo que cambió** (`cambiosDe`), así un `edicion` que
 * corrige una descripción no recibe un 403 por los puntajes que nunca tocó.
 */
export default function FichaDeCondicion({
  fila,
  catalogos,
  hoy,
  puedeEditar,
  esAdmin,
  onGuardada,
  onCerrar,
}: {
  fila: FilaDeCondicion;
  catalogos: Catalogos;
  hoy: string;
  puedeEditar: boolean;
  esAdmin: boolean;
  onGuardada: (fila: FilaDeCondicion) => void;
  onCerrar: () => void;
}) {
  const [borrador, setBorrador] = useState<Borrador>(() => borradorDe(fila));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const estado = estadoDe(fila, hoy);
  const faltas = faltasPendientes(fila, hoy);
  const cerrada = estado === "Cerrada";

  // Una cerrada sólo la corrige un admin: la policy de `edicion` la deja afuera.
  const puedePrimera = puedeEditar && (!cerrada || esAdmin);

  const cambios = cambiosDe(fila, borrador, esAdmin);
  const hayCambios = Object.keys(cambios).length > 0;

  function poner<K extends keyof Borrador>(campo: K, valor: Borrador[K]) {
    setBorrador((b) => ({ ...b, [campo]: valor }));
    setAviso(null);
  }

  // ── Las fotos ──
  const [fotos, setFotos] = useState<Foto[] | null>(null);
  const [errorDeFotos, setErrorDeFotos] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<string | null>(null);

  useCargar(async (vigente) => {
    const r = await fetch(`/api/seguridad-higiene/condiciones/${fila.id}`).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!vigente()) return;
    if (!r || !r.ok) {
      setErrorDeFotos(j?.error ?? "No se pudieron traer las fotos");
      return;
    }
    setFotos(j.data as Foto[]);
  }, [fila.id]);

  async function copiarLink(foto: Foto) {
    if (!foto.link) return;
    try {
      await navigator.clipboard.writeText(foto.link);
      setCopiada(foto.id);
      setTimeout(() => setCopiada((actual) => (actual === foto.id ? null : actual)), 2000);
    } catch {
      setErrorDeFotos("No se pudo copiar el link. Abrí la foto y copialo desde la barra del navegador.");
    }
  }

  // ── El nivel, mientras se elige ──
  const puntajes: Record<Criterio, number | null> = {
    frecuencia: borrador.frecuencia === "" ? null : Number(borrador.frecuencia),
    antecedentes: borrador.antecedentes === "" ? null : Number(borrador.antecedentes),
    controles: borrador.controles === "" ? null : Number(borrador.controles),
    magnitud_dano: borrador.magnitud_dano === "" ? null : Number(borrador.magnitud_dano),
    legislacion: borrador.legislacion === "" ? null : Number(borrador.legislacion),
  };
  const calculado = nivelDeRiesgo(puntajes);
  const clasificacion = calculado ? clasificar(calculado.nivel) : null;
  const puntajesFaltantes = Object.values(puntajes).filter((p) => p === null).length;

  // ── Guardar ──
  async function guardar() {
    setError(null);
    setAviso(null);

    // Lo que la ruta también dice, pero acá se dice antes y sin ir y volver.
    if ("descripcion" in cambios && !borrador.descripcion.trim()) {
      setError("Contá qué viste: la descripción no puede quedar vacía.");
      return;
    }
    if ("accion_propuesta" in cambios && !borrador.accion_propuesta.trim()) {
      setError("Falta la acción propuesta.");
      return;
    }
    if ("sector_id" in cambios && !borrador.lugar.id) {
      setError("Falta decir en qué sector o equipo es.");
      return;
    }

    setGuardando(true);
    try {
      const r = await fetch(`/api/seguridad-higiene/condiciones/${fila.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.error ?? `No se pudo guardar (error ${r.status})`);
        return;
      }
      const guardada = j.data as FilaDeCondicion;
      onGuardada(guardada);
      setBorrador(borradorDe(guardada));
      setAviso("Guardado.");
    } catch {
      setError("No se pudo guardar: parece que no hay conexión.");
    } finally {
      setGuardando(false);
    }
  }

  // ── Las listas de los desplegables ──
  // El valor actual de la condición siempre está, aunque ya no esté activo: si
  // no, el desplegable lo mostraría vacío y guardar lo borraría sin avisar.
  const sectores = catalogos.sectores.filter((s) => s.activo || s.id === borrador.lugar.id);
  const equipos = catalogos.equipos.filter((e) => e.activo || e.id === borrador.lugar.id);
  const peligros = catalogos.peligros.filter((p) => p.activo || p.id === borrador.peligro_id);
  const usuarios = catalogos.usuarios.filter((u) => u.activo || u.id === borrador.responsable_id);

  const nombreDe = (id: string | null) =>
    id ? (catalogos.usuarios.find((u) => u.id === id)?.nombre ?? "alguien") : null;

  const lugarComoTexto = fila.sectores?.nombre
    ? `Sector ${fila.sectores.nombre}`
    : fila.equipos
      ? `Equipo ${fila.equipos.code ? `${fila.equipos.code} · ` : ""}${fila.equipos.name}`
      : null;

  const clase = "input";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Condición ${fila.numero}`}
    >
      <div className="w-full max-w-3xl bg-white sm:rounded-xl sm:shadow-xl">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-lg font-bold text-slate-900">Condición N° {fila.numero}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <InsigniaDeEstado estado={estado} />
              {faltas.map((f) => (
                <InsigniaDeFalta key={f} falta={f} />
              ))}
              {fila.nivel_riesgo !== null && clasificar(fila.nivel_riesgo) && (
                <InsigniaDeClasificacion clasificacion={clasificar(fila.nivel_riesgo)!} />
              )}
            </div>
            <p className="text-xs text-slate-500">
              Detectada el {comoSeLee(fila.detectada_el)}
              {nombreDe(fila.detectada_por) ? ` por ${nombreDe(fila.detectada_por)}` : ""}
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="btn-secondary shrink-0">
            {hayCambios ? "Descartar y cerrar" : "Cerrar"}
          </button>
        </div>

        <div className="space-y-6 p-4">
          {/* Fotos */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Fotos</h3>
            {errorDeFotos && <p className="text-sm text-red-700">{errorDeFotos}</p>}
            {fotos === null && !errorDeFotos && <p className="text-sm text-slate-500">Cargando fotos…</p>}
            {fotos && fotos.length === 0 && (
              <p className="text-sm text-slate-500">Esta condición no tiene fotos.</p>
            )}
            {fotos && fotos.length > 0 && (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fotos.map((foto) => (
                  <li key={foto.id} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
                    {foto.link ? (
                      <a href={foto.link} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={foto.link}
                          alt={`Foto de la condición ${fila.numero}`}
                          loading="lazy"
                          className="h-48 w-full rounded object-cover"
                        />
                      </a>
                    ) : (
                      <p className="flex h-48 items-center justify-center rounded bg-slate-100 px-2 text-center text-xs text-red-700">
                        No se pudo abrir esta foto{foto.error ? `: ${foto.error}` : ""}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {foto.descarga && (
                        <a href={foto.descarga} className="btn-secondary text-xs">
                          Descargar
                        </a>
                      )}
                      {foto.link && (
                        <button type="button" onClick={() => copiarLink(foto)} className="btn-secondary text-xs">
                          {copiada === foto.id ? "Link copiado" : "Copiar link"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {fotos && fotos.length > 0 && (
              <p className="text-xs text-slate-500">
                El link dura una hora: pasado ese tiempo, abrí la condición de nuevo y copiá otro.
              </p>
            )}
          </section>

          {/* Primera etapa */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Qué se vio</h3>

            {puedePrimera ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Campo titulo="Lugar">
                    <Select
                      className={clase}
                      value={borrador.lugar.tipo}
                      onChange={(e) =>
                        poner("lugar", { tipo: e.target.value as Borrador["lugar"]["tipo"], id: "" })
                      }
                    >
                      <option value="">Sin lugar</option>
                      <option value="sector">Un sector</option>
                      <option value="equipo">Un equipo</option>
                    </Select>
                  </Campo>
                  <Campo titulo={borrador.lugar.tipo === "equipo" ? "Equipo" : "Sector"}>
                    {borrador.lugar.tipo === "" ? (
                      <p className="text-sm text-slate-500">Elegí primero si es un sector o un equipo.</p>
                    ) : (
                      <Select
                        className={clase}
                        value={borrador.lugar.id}
                        onChange={(e) =>
                          poner("lugar", { tipo: borrador.lugar.tipo, id: e.target.value })
                        }
                      >
                        <option value="">Elegir…</option>
                        {borrador.lugar.tipo === "sector"
                          ? sectores.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.nombre}
                              </option>
                            ))
                          : equipos.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.nombre}
                              </option>
                            ))}
                      </Select>
                    )}
                  </Campo>
                </div>

                <Campo titulo="Qué se vio">
                  <textarea
                    className={clase}
                    rows={3}
                    value={borrador.descripcion}
                    onChange={(e) => poner("descripcion", e.target.value)}
                  />
                </Campo>

                <Campo titulo="Peligro">
                  <Select
                    className={clase}
                    value={borrador.peligro_id}
                    onChange={(e) => poner("peligro_id", e.target.value)}
                  >
                    <option value="">Sin elegir</option>
                    {peligros.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </Select>
                </Campo>

                <Campo titulo="Acción propuesta">
                  <textarea
                    className={clase}
                    rows={2}
                    value={borrador.accion_propuesta}
                    onChange={(e) => poner("accion_propuesta", e.target.value)}
                  />
                </Campo>

                <Campo titulo="Prioridad">
                  <Select
                    className={clase}
                    value={borrador.prioridad}
                    onChange={(e) => poner("prioridad", e.target.value)}
                  >
                    {borrador.prioridad === "" && <option value="">Sin elegir</option>}
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </Select>
                </Campo>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo titulo="Lugar">
                  <Valor>{lugarComoTexto}</Valor>
                </Campo>
                <Campo titulo="Peligro">
                  <Valor>{fila.syh_peligros?.nombre}</Valor>
                </Campo>
                <div className="sm:col-span-2">
                  <Campo titulo="Qué se vio">
                    <Valor>{fila.descripcion}</Valor>
                  </Campo>
                </div>
                <div className="sm:col-span-2">
                  <Campo titulo="Acción propuesta">
                    <Valor>{fila.accion_propuesta}</Valor>
                  </Campo>
                </div>
                <Campo titulo="Prioridad">
                  <Valor>{fila.prioridad === null ? "" : String(fila.prioridad)}</Valor>
                </Campo>
              </div>
            )}
            {puedeEditar && cerrada && !esAdmin && (
              <p className="text-xs text-slate-500">
                La condición está cerrada: sólo un admin puede corregirla o reabrirla.
              </p>
            )}
          </section>

          {/* Evaluación del riesgo */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Evaluación del riesgo</h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CRITERIOS_EN_ORDEN.map(({ clave, titulo }) => {
                const elegida = CRITERIOS[clave].find((o) => String(o.puntos) === borrador[clave]);
                return (
                  <Campo
                    key={clave}
                    titulo={titulo}
                    ayuda={elegida ? `${elegida.puntos} · ${elegida.texto}` : undefined}
                  >
                    {esAdmin ? (
                      <Select
                        className={clase}
                        value={borrador[clave]}
                        onChange={(e) => poner(clave, e.target.value)}
                      >
                        <option value="">Sin evaluar</option>
                        {CRITERIOS[clave].map((o) => (
                          <option key={o.puntos} value={String(o.puntos)}>
                            {o.puntos} · {recortado(o.texto)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Valor>{elegida ? `${elegida.puntos} puntos` : "Sin evaluar"}</Valor>
                    )}
                  </Campo>
                );
              })}
            </div>

            {/* El resultado, calculado con lo que está elegido: se ve antes de guardar. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              {calculado ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    Probabilidad <b>{calculado.probabilidad}</b>
                  </span>
                  <span>
                    Gravedad <b>{calculado.gravedad}</b>
                  </span>
                  <span>
                    Nivel <b>{calculado.nivel}</b>
                  </span>
                  {clasificacion && <InsigniaDeClasificacion clasificacion={clasificacion} conNombre />}
                  {hayCambios && Object.keys(cambios).some((c) => c in puntajes) && (
                    <span className="text-xs text-slate-500">(todavía sin guardar)</span>
                  )}
                </div>
              ) : (
                <span className="text-amber-800">
                  Sin evaluar: {puntajesFaltantes === 5 ? "no hay ningún puntaje" : `falta${puntajesFaltantes === 1 ? "" : "n"} ${puntajesFaltantes} de 5`}. El nivel
                  se calcula cuando están los cinco.
                </span>
              )}
            </div>
          </section>

          {/* Gestión */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Gestión</h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo titulo="Responsable">
                {esAdmin ? (
                  <Select
                    className={clase}
                    value={borrador.responsable_id}
                    onChange={(e) => poner("responsable_id", e.target.value)}
                  >
                    <option value="">Sin asignar</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre}
                        {u.activo ? "" : " (inactivo)"}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Valor>{nombreDe(fila.responsable_id) ?? "Sin asignar"}</Valor>
                )}
              </Campo>

              <Campo titulo="Fecha máxima de ejecución">
                {esAdmin ? (
                  <input
                    type="date"
                    className={clase}
                    value={borrador.fecha_maxima}
                    onChange={(e) => poner("fecha_maxima", e.target.value)}
                  />
                ) : (
                  <Valor>{fila.fecha_maxima ? comoSeLee(fila.fecha_maxima) : "Sin asignar"}</Valor>
                )}
              </Campo>

              <Campo titulo="Requiere inversión">
                {esAdmin ? (
                  <Select
                    className={clase}
                    value={borrador.requiere_inversion}
                    onChange={(e) => poner("requiere_inversion", e.target.value as Borrador["requiere_inversion"])}
                  >
                    <option value="">Sin definir</option>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </Select>
                ) : (
                  <Valor>
                    {fila.requiere_inversion === null ? "Sin definir" : fila.requiere_inversion ? "Sí" : "No"}
                  </Valor>
                )}
              </Campo>

              <Campo
                titulo="Fecha de ejecución"
                ayuda={
                  esAdmin
                    ? "Tener fecha de ejecución cierra la condición; borrarla la reabre."
                    : undefined
                }
              >
                {esAdmin ? (
                  <div className="space-y-2">
                    <input
                      type="date"
                      className={clase}
                      max={hoy}
                      value={borrador.fecha_ejecucion}
                      onChange={(e) => poner("fecha_ejecucion", e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      {!borrador.fecha_ejecucion && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => poner("fecha_ejecucion", hoy)}
                        >
                          Marcar como ejecutada hoy
                        </button>
                      )}
                      {borrador.fecha_ejecucion && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => poner("fecha_ejecucion", "")}
                        >
                          {cerrada ? "Reabrir" : "Quitar la fecha"}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <Valor>{fila.fecha_ejecucion ? comoSeLee(fila.fecha_ejecucion) : "Todavía no"}</Valor>
                )}
              </Campo>
            </div>

            <Campo titulo="Observaciones">
              {esAdmin ? (
                <textarea
                  className={clase}
                  rows={3}
                  value={borrador.observaciones}
                  onChange={(e) => poner("observaciones", e.target.value)}
                />
              ) : (
                <Valor>{fila.observaciones}</Valor>
              )}
            </Campo>
          </section>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {aviso && !hayCambios && (
            <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              {aviso}
            </p>
          )}

          {(puedePrimera || esAdmin) && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                className="btn-primary"
                disabled={!hayCambios || guardando}
                onClick={guardar}
              >
                {guardando ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
