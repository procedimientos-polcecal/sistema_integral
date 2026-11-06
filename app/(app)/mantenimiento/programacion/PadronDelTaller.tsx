"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { useCargar } from "@/lib/core/useCargar";
import { comoSeLee, hoyEnArgentina } from "@/lib/core/fechas";
import type { Grupo, Oficio } from "@/lib/mantenimiento/programacion";
import { OFICIO_TEXTO, ORDEN_OFICIO, llamar } from "./programacionComun";

/**
 * El padrón del taller: quién es mecánico, electricista o lubricador, de qué
 * grupo y desde cuándo.
 *
 * Sin esto la programación no puede empezar —no hay de dónde sacar a los nueve—
 * y antes de esta sección no había ninguna pantalla que creara una fila de
 * `mant_personal_taller`. Se mantiene **simple a propósito**: es un catálogo de
 * unas nueve filas que cambia cuando alguien entra o se va, no una herramienta
 * de todos los días. Sumar a alguien y cerrarle la vigencia; cambiarle el grupo
 * o el oficio es cerrar la fila y sumar otra, que es lo que la ruta espera para
 * que la semana de antes se siga viendo como se vio.
 *
 * Todas las reglas (fechas, vigencias que no se superponen, grupo según oficio)
 * las pone `/api/mantenimiento/personal`; acá sólo se muestran sus mensajes.
 *
 * ── POR QUÉ HAY UN "VER TAMBIÉN A LOS QUE YA NO ESTÁN" ──────
 *
 * Porque sin él una baja mal cargada no tenía arreglo desde la app. El `GET`
 * traía sólo lo vigente, así que una fila cuyo `hasta` quedaba en el pasado
 * **desaparecía de esta lista** — y el `PATCH` pide el `id` de la fila, que
 * sólo se sabe por esta lista—. Tipear la baja del mes pasado en vez de la del
 * mes que viene sacaba a la persona del padrón, le vaciaba las semanas
 * anteriores y no dejaba camino de vuelta. Desde el 26/10/2026 la casilla pide
 * el padrón entero (`?incluirBajas=1`) y, con la fila a la vista, se le puede
 * cambiar la fecha o sacarle la baja del todo.
 */

interface FilaDelPadron {
  id: string;
  empleado_id: string;
  oficio: Oficio;
  grupo: Grupo | null;
  desde: string;
  hasta: string | null;
  empleados: { nombre: string; apellido: string } | { nombre: string; apellido: string }[] | null;
}

export interface EmpleadoElegible { id: string; nombre: string; apellido: string }

function nombreDe(f: FilaDelPadron): string {
  const e = Array.isArray(f.empleados) ? f.empleados[0] : f.empleados;
  return e ? `${e.nombre} ${e.apellido}` : "(sin nombre)";
}

export default function PadronDelTaller({
  empleados, abiertaAlPrincipio, alCambiar,
}: {
  empleados: EmpleadoElegible[];
  abiertaAlPrincipio: boolean;
  /** Cambió el padrón: hay que volver a pedir la semana. */
  alCambiar: () => void;
}) {
  const hoy = hoyEnArgentina();
  const [abierta, setAbierta] = useState(abiertaAlPrincipio);
  const [filas, setFilas] = useState<FilaDelPadron[] | null>(null);
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null);

  // Las bajas no se traen por defecto —el padrón de todos los días son los que
  // están—, pero tienen que poder traerse: una fila con `hasta` en el pasado es
  // justo la que hay que poder corregir, y el `PATCH` necesita su `id`.
  const [verBajas, setVerBajas] = useState(false);

  const [empleadoId, setEmpleadoId] = useState("");
  const [oficio, setOficio] = useState<Oficio>("mecanico");
  const [grupo, setGrupo] = useState<Grupo>("A");
  const [desde, setDesde] = useState(hoy);
  const [cerrando, setCerrando] = useState<string | null>(null); // id de la fila
  const [hastaDeBaja, setHastaDeBaja] = useState(hoy);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCargar(async (vigente) => {
    const r = await llamar(`/api/mantenimiento/personal${verBajas ? "?incluirBajas=1" : ""}`, "GET");
    if (!vigente()) return;
    if (!r.ok) {
      setErrorDeCarga(r.error);
      return;
    }
    setErrorDeCarga(null);
    setFilas(r.data.data as FilaDelPadron[]);
  }, [verBajas]);

  const ordenadas = [...(filas ?? [])].sort(
    (a, b) =>
      ORDEN_OFICIO[a.oficio] - ORDEN_OFICIO[b.oficio] ||
      (a.grupo ?? "").localeCompare(b.grupo ?? "") ||
      nombreDe(a).localeCompare(nombreDe(b), "es")
  );

  async function hacer(accion: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const r = await accion();
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    recargar();
    alCambiar();
  }

  async function sumar() {
    if (!empleadoId) {
      setError("Falta elegir la persona");
      return;
    }
    await hacer(async () => {
      const r = await llamar("/api/mantenimiento/personal", "POST", {
        empleado_id: empleadoId,
        oficio,
        grupo: oficio === "electricista" ? null : grupo,
        desde,
      });
      if (r.ok) setEmpleadoId("");
      return r;
    });
  }

  async function darDeBaja(id: string) {
    await hacer(async () => {
      const r = await llamar("/api/mantenimiento/personal", "PATCH", { id, hasta: hastaDeBaja });
      if (r.ok) setCerrando(null);
      return r;
    });
  }

  /** La baja que fue un error: la fila vuelve a no tener fin. */
  async function sacarLaBaja(id: string) {
    await hacer(async () => {
      const r = await llamar("/api/mantenimiento/personal", "PATCH", { id, hasta: null });
      if (r.ok) setCerrando(null);
      return r;
    });
  }

  return (
    <section className="card">
      <button
        type="button"
        aria-expanded={abierta}
        onClick={() => setAbierta(!abierta)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-2 text-left"
      >
        <span className="text-sm font-semibold text-slate-800">
          El taller{filas ? ` · ${filas.length} ${filas.length === 1 ? "persona" : "personas"}` : ""}
        </span>
        <span aria-hidden className="text-slate-400">{abierta ? "▲" : "▼"}</span>
      </button>

      {abierta && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          {errorDeCarga && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{errorDeCarga}</p>}
          {filas && filas.length === 0 && (
            <p className="text-sm text-slate-500">
              {verBajas
                ? "No hay ninguna fila en el padrón del taller."
                : "Todavía no hay nadie cargado en el padrón del taller."}
            </p>
          )}

          {/*
            Sin esto, una fila cuya baja quedó en el pasado desaparece de la
            única pantalla que puede corregirla: el `PATCH` pide el `id` y el
            `id` sale de este listado.
          */}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={verBajas}
              onChange={(e) => setVerBajas(e.target.checked)}
              className="h-4 w-4"
            />
            Ver también a los que ya no están (para corregirles la baja)
          </label>

          <ul className="space-y-1.5">
            {ordenadas.map((f) => (
              <li
                key={f.id}
                className={`rounded-lg border px-3 py-2 ${
                  f.hasta && f.hasta < hoy ? "border-slate-200 bg-slate-50" : "border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-medium text-slate-900">
                      {nombreDe(f)}
                      {f.hasta && f.hasta < hoy && (
                        <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          ya no está
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-500">
                      {OFICIO_TEXTO[f.oficio]}
                      {f.grupo && ` · grupo ${f.grupo}`} · desde {comoSeLee(f.desde)}
                      {f.hasta && ` · hasta ${comoSeLee(f.hasta)}`}
                    </span>
                  </span>
                  {cerrando !== f.id && (
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      disabled={enviando}
                      onClick={() => {
                        setCerrando(f.id);
                        setHastaDeBaja(f.hasta ?? hoy);
                        setError(null);
                      }}
                    >
                      {f.hasta ? "Cambiar baja" : "Dar de baja"}
                    </button>
                  )}
                </div>
                {cerrando === f.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label htmlFor={`baja-${f.id}`} className="text-xs text-slate-500">Último día en el taller</label>
                    <div className="w-40">
                      <input
                        id={`baja-${f.id}`}
                        type="date"
                        min={f.desde}
                        value={hastaDeBaja}
                        onChange={(e) => setHastaDeBaja(e.target.value)}
                        className="input"
                      />
                    </div>
                    <button type="button" className="btn-primary" disabled={enviando || !hastaDeBaja} onClick={() => void darDeBaja(f.id)}>
                      Confirmar
                    </button>
                    {/*
                      La baja que no tendría que haber existido: una fecha mal
                      tipeada saca a la persona del padrón y le vacía las
                      semanas. Cambiar el día no alcanza, hay que poder dejarla
                      sin `hasta`.
                    */}
                    {f.hasta && (
                      <button type="button" className="btn-ghost" disabled={enviando} onClick={() => void sacarLaBaja(f.id)}>
                        Sacar la baja
                      </button>
                    )}
                    <button type="button" className="btn-ghost" disabled={enviando} onClick={() => setCerrando(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-800">Sumar a alguien</h3>
            <div>
              <label htmlFor="padron-persona" className="mb-1 block text-xs text-slate-500">Persona</label>
              <Select id="padron-persona" className="input" value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}>
                <option value="">Elegir…</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>{`${e.nombre} ${e.apellido}`}</option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="padron-oficio" className="mb-1 block text-xs text-slate-500">Oficio</label>
                <Select id="padron-oficio" className="input" value={oficio} onChange={(e) => setOficio(e.target.value as Oficio)}>
                  <option value="mecanico">Mecánico</option>
                  <option value="electricista">Electricista</option>
                  <option value="lubricador">Lubricador</option>
                </Select>
              </div>
              {oficio !== "electricista" && (
                <div>
                  <label htmlFor="padron-grupo" className="mb-1 block text-xs text-slate-500">Grupo</label>
                  <Select id="padron-grupo" className="input" value={grupo} onChange={(e) => setGrupo(e.target.value as Grupo)}>
                    <option value="A">Grupo A</option>
                    <option value="B">Grupo B</option>
                  </Select>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="padron-desde" className="mb-1 block text-xs text-slate-500">Desde</label>
              <div className="w-40">
                <input id="padron-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input" />
              </div>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            <button type="button" className="btn-primary w-full" disabled={enviando} onClick={() => void sumar()}>
              Sumar al taller
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
