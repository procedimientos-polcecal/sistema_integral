"use client";

import { useEffect, useMemo, useState } from "react";
import Select from "@/components/Select";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";
import { createClient } from "@/lib/supabase/client";
import { comoSeLee, diaDeLaSemana, hoyEnArgentina, semanaDe, sumarDias } from "@/lib/core/fechas";
import type { Grupo, Oficio, Turno } from "@/lib/mantenimiento/programacion";

/**
 * La semana del taller, para el encargado.
 *
 * LO QUE HAY QUE SABER ANTES DE TOCAR ESTO
 *
 * Las ausencias se cargan **tarde**: mediana de 39 días después de que pasaron,
 * y una sola de 144 se cargó por adelantado. Una pantalla que sólo mostrara lo
 * que RRHH ya cargó mostraría una semana limpia y descubriría los huecos mucho
 * después. Por eso **anotar una ausencia es el camino principal de esta
 * pantalla** y no un formulario aparte: el trabajador se lo dice al encargado en
 * el taller, con el teléfono en la mano, y desde ahí son dos toques —la persona
 * y el tipo—. Ningún botón de tipo pide confirmación, salvo "Otra", que
 * necesita el motivo porque la ruta devuelve un 400 sin él. Lo que se anotó mal
 * se deshace desde el aviso que sale al pie o desde la misma persona.
 *
 * Lo que **no** muestra: por qué falta alguien que cargó otra persona. La ruta
 * de la semana no manda el motivo —es dato médico y disciplinario y el diseño lo
 * deja afuera de Mantenimiento—. Sí muestra el tipo de lo que cargó él mismo,
 * que viene de otra ruta y que lo escribió él.
 */

// ── Lo que devuelven las rutas ───────────────────────────────

interface Asignacion { empleadoId: string; dia: string; turno: Turno; pisada: boolean }
interface Ausente { empleadoId: string; dia: string; turno: Turno; oficio: Oficio }
interface Persona { empleadoId: string; nombre: string; oficio: Oficio; grupo: Grupo | null }
interface SinTurno { empleadoId: string; dia: string }

interface Semana {
  dias: string[];
  asignaciones: Asignacion[];
  ausentes: Ausente[];
  candidatos: Record<string, string[]>;
  sinTurno: SinTurno[];
  personas: Persona[];
  sinReferencia?: true;
}

/** Una ausencia de las que cargó el que mira. Lleva el id: es lo que permite corregirla o borrarla. */
interface AusenciaPropia {
  id: string;
  empleado_id: string;
  fecha_desde: string;
  fecha_hasta: string;
  tipo: string;
  observaciones: string | null;
}

// ── Textos ───────────────────────────────────────────────────

const TURNOS: Turno[] = ["4-12", "8-16", "12-20"];
const TURNO_TEXTO: Record<Turno, string> = { "4-12": "4 a 12", "8-16": "8 a 16", "12-20": "12 a 20" };

const OFICIO_TEXTO: Record<Oficio, string> = {
  mecanico: "Mecánico",
  electricista: "Electricista",
  lubricador: "Lubricador",
};
const ORDEN_OFICIO: Record<Oficio, number> = { mecanico: 0, lubricador: 1, electricista: 2 };

/** Los cuatro tipos que el encargado puede anotar. Los demás los carga RRHH. */
const TIPOS = [
  { valor: "ENFERMEDAD_ACCIDENTE_INCULPABLE", etiqueta: "Enfermedad o accidente" },
  { valor: "PERMISO_PERSONAL", etiqueta: "Permiso personal" },
  { valor: "INJUSTIFICADA", etiqueta: "Injustificada" },
  { valor: "OTRA", etiqueta: "Otra" },
] as const;

function tipoTexto(valor: string): string {
  return TIPOS.find((t) => t.valor === valor)?.etiqueta ?? valor;
}

const DIA_CORTO = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "26/10": el día y el mes, sin el año. */
function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "lunes 26/10" */
function diaLargo(iso: string): string {
  return `${DIA_LARGO[diaDeLaSemana(iso)]} ${diaMes(iso)}`;
}

// ── Llamadas ─────────────────────────────────────────────────

/**
 * Una llamada a la API. Devuelve el error **como lo dijo la ruta**: los mensajes
 * de las rutas de acá están escritos para quien los lee ("Esa persona no es del
 * taller en esas fechas…") y traducirlos los volvería peores.
 */
async function llamar(
  url: string,
  metodo: "GET" | "POST" | "PATCH" | "DELETE",
  cuerpo?: unknown
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error ?? `Falló (error ${res.status})` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "No se pudo conectar. Revisá la señal y volvé a probar." };
  }
}

// ── La pantalla ──────────────────────────────────────────────

export default function ProgramacionClient() {
  const confirmar = useConfirm();
  const hoy = hoyEnArgentina();

  const [lunes, setLunes] = useState(() => semanaDe(hoy)[0]);
  const [dia, setDia] = useState(hoy);
  const [semana, setSemana] = useState<Semana | null>(null);
  const [propias, setPropias] = useState<AusenciaPropia[]>([]);
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null);
  const [hoja, setHoja] = useState<string | null>(null); // empleadoId de la persona abierta
  const [aviso, setAviso] = useState<{
    texto: string;
    error?: boolean;
    deshacer?: () => Promise<void>;
  } | null>(null);

  const recargar = useCargar(
    async (vigente) => {
      const domingo = sumarDias(lunes, 6);
      // Las dos juntas: la semana dice quién falta y la otra trae los ids de lo
      // que cargó el encargado, que es lo que hace alcanzable corregir y borrar.
      const [s, p] = await Promise.all([
        llamar(`/api/mantenimiento/programacion?lunes=${lunes}`, "GET"),
        llamar(`/api/mantenimiento/ausencias?desde=${lunes}&hasta=${domingo}`, "GET"),
      ]);
      if (!vigente()) return;
      if (!s.ok) {
        setErrorDeCarga(s.error);
        setSemana(null);
        return;
      }
      setErrorDeCarga(null);
      setSemana(s.data as Semana);
      // Si falla la lista de lo propio, la semana se ve igual: lo único que se
      // pierde es poder corregir. Se dice, no se calla.
      if (p.ok) setPropias(p.data.data as AusenciaPropia[]);
      else {
        setPropias([]);
        setAviso({ texto: `No se pudo traer lo que cargaste vos: ${p.error}`, error: true });
      }
    },
    [lunes]
  );

  // El aviso de éxito se va solo; el de error se queda hasta que lo cierren.
  useEffect(() => {
    if (!aviso || aviso.error) return;
    const t = setTimeout(() => setAviso(null), 9000);
    return () => clearTimeout(t);
  }, [aviso]);

  const personaPorId = useMemo(() => {
    const m = new Map<string, Persona>();
    for (const p of semana?.personas ?? []) m.set(p.empleadoId, p);
    return m;
  }, [semana]);

  function irA(nuevoLunes: string, nuevoDia: string) {
    setLunes(nuevoLunes);
    setDia(nuevoDia);
    setHoja(null);
  }
  const moverSemana = (delta: number) => irA(sumarDias(lunes, 7 * delta), sumarDias(dia, 7 * delta));
  const irAHoy = () => irA(semanaDe(hoy)[0], hoy);

  // ── Anotar una ausencia: la acción que más importa ──
  async function anotarAusencia(
    empleadoId: string,
    desde: string,
    hasta: string,
    tipo: string,
    observaciones: string | null
  ): Promise<string | null> {
    const r = await llamar("/api/mantenimiento/ausencias", "POST", {
      empleadoId,
      fechaDesde: desde,
      fechaHasta: hasta,
      tipo,
      observaciones,
    });
    // Se recarga también si falló: el error 500 de la ruta dice que la fila puede
    // haber quedado escrita, y la pantalla tiene que mostrar lo que hay.
    recargar();
    if (!r.ok) return r.error;

    const id = r.data?.data?.id as string | undefined;
    const quien = personaPorId.get(empleadoId)?.nombre ?? "La persona";
    const cuando = desde === hasta ? diaLargo(desde) : `del ${diaMes(desde)} al ${diaMes(hasta)}`;
    setHoja(null);
    setAviso({
      texto: `Anotada la falta de ${quien}, ${cuando}: ${tipoTexto(tipo).toLowerCase()}.`,
      deshacer: id
        ? async () => {
            const d = await llamar(`/api/mantenimiento/ausencias?id=${id}`, "DELETE");
            recargar();
            setAviso(
              d.ok ? { texto: "Deshecho: la falta ya no figura." } : { texto: d.error, error: true }
            );
          }
        : undefined,
    });
    return null;
  }

  async function corregirAusencia(
    id: string,
    cambios: { tipo: string; fechaHasta: string; observaciones: string | null }
  ): Promise<string | null> {
    const r = await llamar("/api/mantenimiento/ausencias", "PATCH", { id, ...cambios });
    recargar();
    if (!r.ok) return r.error;
    setHoja(null);
    setAviso({ texto: "Corregida la ausencia." });
    return null;
  }

  async function borrarAusencia(a: AusenciaPropia): Promise<string | null> {
    const quien = personaPorId.get(a.empleado_id)?.nombre ?? "esa persona";
    const rango =
      a.fecha_desde === a.fecha_hasta
        ? `el ${comoSeLee(a.fecha_desde)}`
        : `del ${comoSeLee(a.fecha_desde)} al ${comoSeLee(a.fecha_hasta)}`;
    const ok = await confirmar({
      title: "Sacar la ausencia",
      message: `¿Sacar la ausencia de ${quien} ${rango}? Queda anotado en el registro de auditoría.`,
      confirmText: "Sacar",
      danger: true,
    });
    if (!ok) return null;
    const r = await llamar(`/api/mantenimiento/ausencias?id=${a.id}`, "DELETE");
    recargar();
    if (!r.ok) return r.error;
    setHoja(null);
    setAviso({ texto: "Sacada la ausencia." });
    return null;
  }

  // ── Mover a alguien de turno (una pisada) ──
  async function moverDeTurno(empleadoId: string, d: string, turno: Turno): Promise<string | null> {
    const r = await llamar("/api/mantenimiento/programacion/pisadas", "POST", { empleadoId, dia: d, turno });
    recargar();
    if (!r.ok) return r.error;
    const quien = personaPorId.get(empleadoId)?.nombre ?? "La persona";
    setHoja(null);
    setAviso({ texto: `${quien} pasa a ${TURNO_TEXTO[turno]} el ${diaLargo(d)}.` });
    return null;
  }

  async function volverAlCiclo(empleadoId: string, d: string): Promise<string | null> {
    const r = await llamar(
      `/api/mantenimiento/programacion/pisadas?empleadoId=${empleadoId}&dia=${d}`,
      "DELETE"
    );
    recargar();
    if (!r.ok) return r.error;
    setHoja(null);
    setAviso({ texto: "Vuelve al turno que le toca por el ciclo." });
    return null;
  }

  // ── Lo que se muestra ──
  const dias = semana?.dias ?? semanaDe(lunes);
  const diaActivo = dias.includes(dia) ? dia : dias[0];

  const delDia = (d: string, turno: Turno) =>
    (semana?.asignaciones ?? [])
      .filter((a) => a.dia === d && a.turno === turno)
      .sort((x, y) => {
        const px = personaPorId.get(x.empleadoId);
        const py = personaPorId.get(y.empleadoId);
        const o = (px ? ORDEN_OFICIO[px.oficio] : 9) - (py ? ORDEN_OFICIO[py.oficio] : 9);
        return o || (px?.nombre ?? "").localeCompare(py?.nombre ?? "", "es");
      });

  const ausenteEse = (empleadoId: string, d: string) =>
    (semana?.ausentes ?? []).find((a) => a.empleadoId === empleadoId && a.dia === d);

  const huecosDelDia = (d: string) => (semana?.ausentes ?? []).filter((a) => a.dia === d).length;

  const huecosDeLaSemana = semana?.ausentes.length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Programación del taller</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Quién está en cada turno y quién falta. Tocá a la persona que no viene para anotar su falta.
        </p>
      </div>

      {/* La semana: anterior, esta, siguiente. */}
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => moverSemana(-1)} aria-label="Semana anterior">
          ←
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold text-slate-800">
            {diaMes(dias[0])} al {comoSeLee(dias[6])}
          </p>
          {lunes !== semanaDe(hoy)[0] && (
            <button type="button" onClick={irAHoy} className="text-xs text-[var(--primary-dark)] underline">
              Volver a esta semana
            </button>
          )}
        </div>
        <button type="button" className="btn-secondary" onClick={() => moverSemana(1)} aria-label="Semana siguiente">
          →
        </button>
      </div>

      {errorDeCarga && (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">
          No se pudo traer la semana: {errorDeCarga}
        </div>
      )}

      {!semana && !errorDeCarga && <p className="text-sm text-slate-400">Cargando…</p>}

      {semana?.sinReferencia && (
        <SinReferencia lunes={lunes} personas={semana.personas} alCargar={recargar} />
      )}

      {semana && !semana.sinReferencia && (
        <>
          {/* Los siete días, con cuántos faltan en cada uno. */}
          <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Días de la semana">
            {dias.map((d) => {
              const faltan = huecosDelDia(d);
              const activo = d === diaActivo;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={activo}
                  onClick={() => setDia(d)}
                  className={`relative min-w-[3.1rem] flex-1 rounded-lg border px-1 py-2 text-center ${
                    activo
                      ? "border-[var(--primary)] bg-[var(--primary-light)] text-slate-900"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <span className="block text-[11px] uppercase">{DIA_CORTO[diaDeLaSemana(d)]}</span>
                  <span className={`block text-sm ${d === hoy ? "font-bold" : "font-medium"}`}>
                    {d.slice(8, 10)}
                  </span>
                  {faltan > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white">
                      {faltan}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-sm font-medium capitalize text-slate-700">
            {diaLargo(diaActivo)}
            {diaActivo === hoy && <span className="ml-2 text-xs font-normal normal-case text-slate-400">hoy</span>}
          </p>

          {/* El día elegido: tres turnos, y cada persona es un botón. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {TURNOS.map((turno) => {
              const gente = delDia(diaActivo, turno);
              return (
                <section key={turno} className="card p-3">
                  <h2 className="mb-2 text-sm font-semibold text-slate-800">{TURNO_TEXTO[turno]}</h2>
                  {gente.length === 0 && <p className="text-sm text-slate-400">Nadie asignado.</p>}
                  <ul className="space-y-1.5">
                    {gente.map((a) => {
                      const p = personaPorId.get(a.empleadoId);
                      const falta = ausenteEse(a.empleadoId, diaActivo);
                      const candidatos = falta
                        ? (semana.candidatos[`${diaActivo}|${falta.turno}|${falta.oficio}`] ?? [])
                        : [];
                      return (
                        <li key={a.empleadoId}>
                          <button
                            type="button"
                            onClick={() => setHoja(a.empleadoId)}
                            className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left ${
                              falta ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className={`block truncate text-sm font-medium ${falta ? "text-red-800" : "text-slate-900"}`}>
                                {p?.nombre ?? "(sin nombre)"}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {p ? OFICIO_TEXTO[falta?.oficio ?? p.oficio] : ""}
                                {p?.grupo && ` · grupo ${p.grupo}`}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              {falta && (
                                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                  No está
                                </span>
                              )}
                              {a.pisada && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                  Movido
                                </span>
                              )}
                            </span>
                          </button>
                          {falta && (
                            <p className="mt-1 px-1 text-xs text-slate-600">
                              {candidatos.length === 0
                                ? "Nadie libre del mismo oficio para taparlo."
                                : `Pueden taparlo: ${candidatos
                                    .map((c) => {
                                      const t = semana.asignaciones.find((x) => x.empleadoId === c && x.dia === diaActivo)?.turno;
                                      return `${personaPorId.get(c)?.nombre ?? "?"}${t ? ` (${TURNO_TEXTO[t]})` : ""}`;
                                    })
                                    .join(", ")}.`}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          {/* En el padrón ese día pero sin turno: si no se dice, no aparecen en ningún lado. */}
          {semana.sinTurno.some((s) => s.dia === diaActivo) && (
            <section className="card border-amber-200 bg-amber-50 p-3">
              <h2 className="mb-1 text-sm font-semibold text-amber-900">Sin turno este día</h2>
              <p className="mb-2 text-xs text-amber-900">
                Son del taller pero el ciclo no les da turno. Tocá a uno para asignárselo.
              </p>
              <ul className="space-y-1.5">
                {semana.sinTurno
                  .filter((s) => s.dia === diaActivo)
                  .map((s) => {
                    const p = personaPorId.get(s.empleadoId);
                    return (
                      <li key={s.empleadoId}>
                        <button
                          type="button"
                          onClick={() => setHoja(s.empleadoId)}
                          className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-left"
                        >
                          <span className="truncate text-sm font-medium text-slate-900">{p?.nombre ?? "(sin nombre)"}</span>
                          <span className="shrink-0 text-xs text-slate-500">{p ? OFICIO_TEXTO[p.oficio] : ""}</span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}

          {/* La semana entera de un vistazo. */}
          <section>
            <h2 className="mb-1.5 text-sm font-semibold text-slate-700">
              La semana
              {huecosDeLaSemana > 0 && (
                <span className="ml-2 text-xs font-normal text-red-700">
                  {huecosDeLaSemana} {huecosDeLaSemana === 1 ? "falta" : "faltas"}
                </span>
              )}
            </h2>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="w-16 px-2 py-2 text-left font-medium">Turno</th>
                    {dias.map((d) => (
                      <th key={d} className="px-1 py-2 text-left font-medium">
                        <button
                          type="button"
                          onClick={() => setDia(d)}
                          className={`rounded px-1 ${d === diaActivo ? "bg-[var(--primary-light)] text-slate-900" : ""}`}
                        >
                          {DIA_CORTO[diaDeLaSemana(d)]} {d.slice(8, 10)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TURNOS.map((turno) => (
                    <tr key={turno} className="border-b border-slate-100 align-top last:border-0">
                      <th className="px-2 py-2 text-left font-medium text-slate-700">{TURNO_TEXTO[turno]}</th>
                      {dias.map((d) => (
                        <td key={d} className="px-1 py-1.5">
                          <ul className="space-y-0.5">
                            {delDia(d, turno).map((a) => {
                              const falta = ausenteEse(a.empleadoId, d);
                              return (
                                <li key={a.empleadoId}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDia(d);
                                      setHoja(a.empleadoId);
                                    }}
                                    className={`block w-full truncate rounded px-1 py-0.5 text-left ${
                                      falta ? "bg-red-100 text-red-800 line-through" : "text-slate-700"
                                    }`}
                                    title={personaPorId.get(a.empleadoId)?.nombre}
                                  >
                                    {personaPorId.get(a.empleadoId)?.nombre ?? "?"}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* La hoja de una persona: desde acá se anota la falta. */}
      {semana && !semana.sinReferencia && hoja && personaPorId.get(hoja) && (
        <HojaDePersona
          key={`${hoja}|${diaActivo}`}
          persona={personaPorId.get(hoja)!}
          dia={diaActivo}
          asignacion={semana.asignaciones.find((a) => a.empleadoId === hoja && a.dia === diaActivo)}
          falta={ausenteEse(hoja, diaActivo)}
          propia={propias.find(
            (a) => a.empleado_id === hoja && a.fecha_desde <= diaActivo && diaActivo <= a.fecha_hasta
          )}
          candidatos={(() => {
            const f = ausenteEse(hoja, diaActivo);
            return f ? (semana.candidatos[`${diaActivo}|${f.turno}|${f.oficio}`] ?? []) : [];
          })()}
          turnoDe={(id) => semana.asignaciones.find((x) => x.empleadoId === id && x.dia === diaActivo)?.turno}
          nombreDe={(id) => personaPorId.get(id)?.nombre ?? "?"}
          alCerrar={() => setHoja(null)}
          alAnotar={anotarAusencia}
          alCorregir={corregirAusencia}
          alBorrar={borrarAusencia}
          alMover={moverDeTurno}
          alVolverAlCiclo={volverAlCiclo}
        />
      )}

      {aviso && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-20 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-lg sm:bottom-6 ${
            aviso.error ? "bg-red-700 text-white" : "bg-slate-900 text-white"
          }`}
        >
          <span className="min-w-0 flex-1">{aviso.texto}</span>
          {aviso.deshacer && (
            <button
              type="button"
              className="shrink-0 rounded px-2 py-1 font-semibold underline"
              onClick={() => void aviso.deshacer?.()}
            >
              Deshacer
            </button>
          )}
          <button type="button" className="shrink-0 px-1 text-lg leading-none" aria-label="Cerrar" onClick={() => setAviso(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// ── La hoja de una persona ───────────────────────────────────

function HojaDePersona({
  persona, dia, asignacion, falta, propia, candidatos, turnoDe, nombreDe,
  alCerrar, alAnotar, alCorregir, alBorrar, alMover, alVolverAlCiclo,
}: {
  persona: Persona;
  dia: string;
  asignacion?: Asignacion;
  falta?: Ausente;
  propia?: AusenciaPropia;
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
                  {propia.fecha_desde === propia.fecha_hasta
                    ? `el ${comoSeLee(propia.fecha_desde)}`
                    : `del ${comoSeLee(propia.fecha_desde)} al ${comoSeLee(propia.fecha_hasta)}`}
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
                        disabled={enviando || (tipoNuevo === "OTRA" && !motivoNuevo.trim())}
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
                La falta la cargó otra persona. Desde acá no se ve el motivo ni se puede tocar.
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

// ── Falta la semana de referencia ────────────────────────────

/**
 * Sin la semana de referencia no hay ciclo que calcular: no se puede saber qué
 * grupo está en 4 a 12 ni dónde está cada electricista. Se dice, se muestra a
 * quién tiene el taller, y se ofrece cargarla —en vez de dibujar una grilla
 * vacía que parece una semana sin gente.
 *
 * La referencia es **la semana que se está mirando**: así el lunes es siempre un
 * lunes y no hay una fecha que escribir. `mant_programacion_referencia` está
 * cerrada con `mant_es_admin()`, y la pantalla sólo la ve ese nivel, así que se
 * escribe con la sesión de quien mira y es la policy la que defiende.
 */
function SinReferencia({
  lunes, personas, alCargar,
}: {
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
    const elegidos = [e412, e816, e1220];
    if (elegidos.some((e) => !e)) {
      setError("Falta elegir el electricista de cada turno");
      return;
    }
    if (new Set(elegidos).size !== 3) {
      setError("Cada turno lleva un electricista distinto");
      return;
    }
    setEnviando(true);
    setError(null);
    const { error: e } = await createClient().from("mant_programacion_referencia").insert({
      lunes,
      grupo_en_4a12: grupo,
      electricista_4a12_id: e412,
      electricista_8a16_id: e816,
      electricista_12a20_id: e1220,
    });
    setEnviando(false);
    if (e) {
      setError(`No se pudo guardar la referencia: ${e.message}`);
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
          semana. Decí cómo está la semana del {diaMes(lunes)} y desde ahí se calculan todas las demás.
        </p>
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">
          El taller tiene {personas.length} {personas.length === 1 ? "persona" : "personas"}
        </h2>
        {personas.length === 0 ? (
          <p className="text-sm text-slate-500">
            El padrón del taller está vacío: hay que cargar quién es mecánico, electricista y lubricador antes de
            armar la semana.
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
          La referencia pide tres electricistas, y el padrón tiene {electricistas.length}.
        </p>
      )}
    </div>
  );
}
