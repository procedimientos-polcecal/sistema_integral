"use client";

import { useCallback, useEffect, useState } from "react";
import CadenaDeFechas from "@/components/mantenimiento/CadenaDeFechas";
import PostergarOTModal from "../ordenes/PostergarOTModal";
import { comoSeLee, fechaEnArgentina, hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import type { AnalisisDeLaSemana, OrdenParaAnalisis } from "@/lib/mantenimiento/analisisDeOt";
import type { Reprogramacion } from "@/lib/mantenimiento/reprogramaciones";

/** Lo que contesta `GET /api/mantenimiento/analisis`. */
interface Respuesta {
  analisis: AnalisisDeLaSemana;
  necesitan: OrdenParaAnalisis[];
  reprogramaciones: {
    ot_id: string;
    ot_number: number | null;
    sector_raw: string | null;
    equipo_raw: string | null;
    descripcion: string | null;
    fecha_vigente: string | null;
    cadena: string[];
    dias: number;
    movimientos: (Reprogramacion & { dias: number | null })[];
  }[];
  /** id de usuario → nombre. Una clave puede faltar (usuario borrado). */
  autores: Record<string, string>;
}

type Pestania = "conInicio" | "sinCerrar" | "fueraDeFecha" | "cerradas" | "reprogramaciones" | "necesitan";

/** Número de semana ISO del lunes dado: la semana que contiene a su jueves. */
function numeroDeSemana(lunes: string): number {
  const jueves = new Date(`${sumarDias(lunes, 3)}T00:00:00Z`);
  const primeroDeEnero = Date.UTC(jueves.getUTCFullYear(), 0, 1);
  const diaDelAnio = Math.floor((jueves.getTime() - primeroDeEnero) / 86_400_000) + 1;
  return Math.ceil(diaDelAnio / 7);
}

function comoPorcentaje(c: number | null): string {
  if (c === null) return "—";
  return `${(c * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
}

export default function AnalisisClient({ canEdit }: { canEdit: boolean }) {
  // Cualquier día de la semana mirada: la ruta saca el lunes sola.
  const [dia, setDia] = useState(() => hoyEnArgentina());
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [pestania, setPestania] = useState<Pestania>("conInicio");
  const [postergando, setPostergando] = useState<OrdenParaAnalisis | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError("");
    fetch(`/api/mantenimiento/analisis?semana=${dia}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "No se pudo cargar el análisis.");
        return j as Respuesta;
      })
      .then((j) => { if (vigente) setDatos(j); })
      .catch((e: Error) => { if (vigente) setError(e.message); })
      .finally(() => { if (vigente) setCargando(false); });
    // Si se cambia de semana mientras la anterior carga, la respuesta vieja no
    // tiene que pisar a la nueva.
    return () => { vigente = false; };
  }, [dia, recarga]);

  const recargar = useCallback(() => setRecarga((n) => n + 1), []);
  const a = datos?.analisis;

  const pestanias: { id: Pestania; rotulo: string; cantidad: number | null }[] = [
    { id: "conInicio", rotulo: "Con inicio en la semana", cantidad: a?.conInicio ?? null },
    { id: "sinCerrar", rotulo: "Sin cerrar", cantidad: a?.listas.sinCerrar.length ?? null },
    { id: "fueraDeFecha", rotulo: "Cerradas fuera de fecha", cantidad: a?.listas.cerradasFueraDeFecha.length ?? null },
    { id: "cerradas", rotulo: "Cerradas en la semana", cantidad: a?.cerradasEnLaSemana ?? null },
    { id: "reprogramaciones", rotulo: "Reprogramaciones", cantidad: datos?.reprogramaciones.length ?? null },
    // Es la única que no se mueve con las flechas: lleva «hoy» para que un
    // número quieto al lado de cuatro que cambian no se lea como un error.
    { id: "necesitan", rotulo: "Necesitan reprogramarse (hoy)", cantidad: datos?.necesitan.length ?? null },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Análisis de OT</h1>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDia(sumarDias(dia, -7))} aria-label="Semana anterior">←</button>
          <div className="text-center text-sm min-w-[11rem]">
            {a ? (
              <>
                <div className="font-semibold">Semana {numeroDeSemana(a.lunes)}</div>
                <div className="text-slate-500">{comoSeLee(a.lunes)} al {comoSeLee(a.domingo)}</div>
              </>
            ) : <div className="text-slate-400">…</div>}
          </div>
          <button type="button" className="btn-secondary" onClick={() => setDia(sumarDias(dia, 7))} aria-label="Semana siguiente">→</button>
        </div>
      </div>

      {error && (
        <div className="card text-sm" role="alert" style={{ borderColor: "#FCA5A5" }}>
          {error}{" "}
          <button type="button" className="btn-secondary" onClick={recargar}>Reintentar</button>
        </div>
      )}

      {!a && cargando && !error && <p className="text-sm text-slate-500">Cargando…</p>}

      {a && datos && (
        <div className={cargando ? "opacity-60 transition-opacity space-y-5" : "space-y-5"}>
          {/* Tres columnas en 343 px no entran con su rótulo: dos hasta sm, tres hasta lg. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Metrica rotulo="Con inicio en la semana" valor={String(a.conInicio)} />
            <Metrica rotulo="Cerradas dentro de su semana" valor={String(a.cerradasDentro)} />
            <Metrica rotulo="Cumplimiento" valor={comoPorcentaje(a.cumplimiento)} />
            <Metrica rotulo="No cerraron en su semana" valor={String(a.noCerraron)} />
            <Metrica rotulo="Cerradas en la semana" valor={String(a.cerradasEnLaSemana)} />
            <Metrica rotulo="Correctivas cerradas" valor={String(a.correctivasCerradas)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card space-y-3">
              <h2 className="font-semibold text-sm">Tipo de mantenimiento cerrado</h2>
              <p className="text-sm text-slate-700">{a.diagnostico}</p>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>Tipo</th><th className="text-right">Cantidad</th><th className="text-right">%</th></tr></thead>
                  <tbody>
                    {a.porTipo.map((t) => (
                      <tr key={t.tipo}>
                        <td>{t.tipo}</td>
                        <td className="text-right tabular-nums">{t.cantidad}</td>
                        <td className="text-right tabular-nums">{t.porcentaje.toLocaleString("es-AR", { minimumFractionDigits: 1 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card space-y-2">
              <h2 className="font-semibold text-sm">Las {a.noCerraron} que no cerraron en su semana</h2>
              <ul className="text-sm space-y-1">
                <li><strong>{a.lasDiez.siguenAbiertas}</strong> siguen abiertas</li>
                <li>
                  <strong>{a.lasDiez.cerraronDespues}</strong> cerraron después del domingo
                  {a.lasDiez.sinFechaDeCierre > 0 && (
                    <span className="text-slate-500"> ({a.lasDiez.sinFechaDeCierre} sin que conste cuándo)</span>
                  )}
                </li>
                <li><strong>{a.lasDiez.cerraronAntes}</strong> cerraron antes del lunes</li>
              </ul>
            </div>
          </div>

          <div role="tablist" className="flex flex-wrap gap-2">
            {pestanias.map((p) => {
              const activa = p.id === pestania;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={activa}
                  onClick={() => setPestania(p.id)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${activa ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700 border-slate-300"}`}
                >
                  {p.rotulo}{p.cantidad !== null ? ` · ${p.cantidad}` : ""}
                </button>
              );
            })}
          </div>

          {pestania === "conInicio" && <ListaDeOrdenes ordenes={a.listas.conInicio} vacia="Ninguna OT empieza en esta semana." />}
          {pestania === "sinCerrar" && <ListaDeOrdenes ordenes={a.listas.sinCerrar} vacia="No quedó ninguna sin cerrar." />}
          {pestania === "fueraDeFecha" && <ListaDeOrdenes ordenes={a.listas.cerradasFueraDeFecha} vacia="Ninguna cerró fuera de fecha." conCierre />}
          {pestania === "cerradas" && <ListaDeOrdenes ordenes={a.listas.cerradasEnLaSemana} vacia="No se cerró ninguna OT en la semana." conCierre />}
          {pestania === "reprogramaciones" && <Reprogramaciones datos={datos} />}
          {pestania === "necesitan" && (
            <Necesitan ordenes={datos.necesitan} canEdit={canEdit} onPostergar={setPostergando} />
          )}
        </div>
      )}

      {postergando && (
        <PostergarOTModal
          orden={postergando}
          onCerrar={() => setPostergando(null)}
          onPostergada={() => { setPostergando(null); recargar(); }}
        />
      )}
    </div>
  );
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="card">
      <div className="text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="text-xs text-slate-500">{rotulo}</div>
    </div>
  );
}

function Orden({ o, conCierre }: { o: OrdenParaAnalisis; conCierre?: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-semibold">OT {o.ot_number}</span>
        <span className="text-slate-600">{[o.sector_raw, o.equipo_raw].filter(Boolean).join(" · ") || "Sin sector ni equipo"}</span>
        <span className="text-slate-400 text-xs">
          Inicio {o.fecha_ejecucion ? comoSeLee(o.fecha_ejecucion) : "sin fecha"}
          {conCierre && ` · Cierre ${o.fecha_cierre ? comoSeLee(o.fecha_cierre) : "sin fecha"}`}
          {o.estado ? ` · ${o.estado}` : ""}
        </span>
      </div>
      {o.descripcion && <p className="text-sm text-slate-600 break-words">{o.descripcion}</p>}
    </>
  );
}

function ListaDeOrdenes({ ordenes, vacia, conCierre }: { ordenes: OrdenParaAnalisis[]; vacia: string; conCierre?: boolean }) {
  if (ordenes.length === 0) return <p className="text-sm text-slate-500">{vacia}</p>;
  return (
    <ul className="space-y-2">
      {ordenes.map((o) => (
        <li key={o.id} className="card space-y-1"><Orden o={o} conCierre={conCierre} /></li>
      ))}
    </ul>
  );
}

function Necesitan({ ordenes, canEdit, onPostergar }: {
  ordenes: OrdenParaAnalisis[]; canEdit: boolean; onPostergar: (o: OrdenParaAnalisis) => void;
}) {
  const desdeElSistema = ordenes.filter((o) => o.app_created).length;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Abiertas con la fecha de inicio ya pasada, contra hoy: no cambia al mover la semana.
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="badge badge-fs">{ordenes.length} en total</span>
        <span className="badge badge-op">{desdeElSistema} se pueden postergar desde el sistema</span>
        <span className="badge badge-rep">{ordenes.length - desdeElSistema} hay que cambiarlas en la planilla</span>
      </div>
      {ordenes.length === 0 ? (
        <p className="text-sm text-slate-500">No hay ninguna OT abierta con la fecha vencida.</p>
      ) : (
        <ul className="space-y-2">
          {ordenes.map((o) => (
            <li key={o.id} className="card flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div className="space-y-1 min-w-0"><Orden o={o} /></div>
              <div className="shrink-0 text-sm">
                {o.app_created ? (
                  canEdit && <button type="button" className="btn-secondary" onClick={() => onPostergar(o)}>Postergar</button>
                ) : (
                  <span className="text-slate-500">Entró por el formulario — se cambia en la planilla</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Reprogramaciones({ datos }: { datos: Respuesta }) {
  if (datos.reprogramaciones.length === 0) {
    return <p className="text-sm text-slate-500">Ninguna OT se reprogramó en esta semana.</p>;
  }
  return (
    <ul className="space-y-2">
      {datos.reprogramaciones.map((r) => (
        <li key={r.ot_id} className="card space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="font-semibold">{r.ot_number !== null ? `OT ${r.ot_number}` : "OT que ya no está"}</span>
            <span className="text-slate-600">{[r.sector_raw, r.equipo_raw].filter(Boolean).join(" · ")}</span>
            <span className="text-slate-400 text-xs">
              {r.dias > 0 ? `${r.dias} días de más` : r.dias < 0 ? `${-r.dias} días de menos` : "sin diferencia"} en total
            </span>
          </div>
          {r.descripcion && <p className="text-sm text-slate-600 break-words">{r.descripcion}</p>}
          <CadenaDeFechas fechas={r.cadena} />
          <ul className="space-y-1 border-t border-slate-100 pt-2">
            {r.movimientos.map((m) => (
              <li key={m.id} className="text-xs text-slate-600">
                <span className="tabular-nums">{comoSeLee(fechaEnArgentina(new Date(m.creado_en)))}</span>
                {" · "}
                {m.fecha_anterior ? comoSeLee(m.fecha_anterior) : "sin fecha"} → {comoSeLee(m.fecha_nueva)}
                {m.dias !== null && ` (${m.dias > 0 ? "+" : ""}${m.dias} d)`}
                {" · "}
                {m.origen === "planilla" ? (
                  // La sincronización no sabe quién ni por qué: ni razón, ni
                  // justificación, ni autor. Mostrarlos vacíos sería inventarlos.
                  <span className="font-medium">Cambiada en la planilla</span>
                ) : (
                  <>
                    <span className="font-medium">{m.razon_etiqueta ?? m.razon ?? "Sin razón"}</span>
                    {m.justificacion && <> — «{m.justificacion}»</>}
                    {" · "}
                    {(m.creado_por && datos.autores[m.creado_por]) || "autor que ya no figura"}
                  </>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
