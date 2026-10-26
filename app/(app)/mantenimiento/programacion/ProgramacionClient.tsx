"use client";

import { useEffect, useMemo, useState } from "react";
import Select from "@/components/Select";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";
import { comoSeLee, diaDeLaSemana, hoyEnArgentina, semanaDe, sumarDias } from "@/lib/core/fechas";
import type { Turno } from "@/lib/mantenimiento/programacion";
import HojaDePersona from "./HojaDePersona";
import PadronDelTaller, { type EmpleadoElegible } from "./PadronDelTaller";
import SinReferencia from "./SinReferencia";
import {
  DIA_CORTO, OFICIO_TEXTO, ORDEN_OFICIO, TURNOS, TURNO_TEXTO,
  diaLargo, diaMes, llamar, rangoComoSeLee, tipoTexto,
  type AusenciaPropia, type Persona, type Semana,
} from "./programacionComun";

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

// ── La pantalla ──────────────────────────────────────────────

export default function ProgramacionClient({ empleados }: { empleados: EmpleadoElegible[] }) {
  const confirmar = useConfirm();
  const hoy = hoyEnArgentina();

  const [lunes, setLunes] = useState(() => semanaDe(hoy)[0]);
  const [dia, setDia] = useState(hoy);
  const [semana, setSemana] = useState<Semana | null>(null);
  const [propias, setPropias] = useState<AusenciaPropia[]>([]);
  // Si se pudo traer lo que cargó el encargado. Distingue "esta falta no es
  // mía" de "no sé cuáles son mías", que la hoja no puede tratar igual.
  const [seSabeLoPropio, setSeSabeLoPropio] = useState(true);
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
      if (p.ok) {
        setPropias(p.data.data as AusenciaPropia[]);
        setSeSabeLoPropio(true);
      } else {
        setPropias([]);
        setSeSabeLoPropio(false);
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
    const rango = rangoComoSeLee(a.fecha_desde, a.fecha_hasta);
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
        <SinReferencia lunes={semanaDe(hoy)[0]} personas={semana.personas} alCargar={recargar} />
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

          {/*
            En el padrón ese día pero sin turno: si no se dice, no aparecen en
            ningún lado. A propósito, desde acá **no se les puede anotar una
            falta**: sin turno no hay hueco que dejar, y la hoja sólo les ofrece
            asignarles uno. Es defendible, pero ojo con quién cae acá: un
            electricista que no es uno de los tres de la referencia es justo la
            persona cuya ausencia hoy no registra nadie. Si algún día hace falta,
            es cambiar `HojaDePersona` para que ofrezca la falta sin `asignacion`.
          */}
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

      {/* Sin el padrón no hay semana: se carga y se mantiene acá. */}
      {semana && (
        <PadronDelTaller
          empleados={empleados}
          abiertaAlPrincipio={semana.personas.length === 0}
          alCambiar={recargar}
        />
      )}

      {/* La hoja de una persona: desde acá se anota la falta. */}
      {semana && !semana.sinReferencia && hoja && personaPorId.get(hoja) && (
        <HojaDePersona
          key={`${hoja}|${diaActivo}`}
          persona={personaPorId.get(hoja)!}
          dia={diaActivo}
          asignacion={semana.asignaciones.find((a) => a.empleadoId === hoja && a.dia === diaActivo)}
          falta={ausenteEse(hoja, diaActivo)}
          seSabeLoPropio={seSabeLoPropio}
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
