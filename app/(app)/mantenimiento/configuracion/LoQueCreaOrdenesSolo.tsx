"use client";

import Link from "next/link";
import { comoSeLee } from "@/lib/core/fechas";
import { caraDeLaVuelta, type Decision } from "@/lib/mantenimiento/cicloDeOT";
import { arrancaSolo, comoSeLeeLaDecision } from "@/lib/mantenimiento/configurarElCiclo";

export interface CicloDeLaSeccion {
  id: string;
  equipoId: string;
  equipoCode: string | null;
  equipoNombre: string | null;
  tareaMadreId: string;
  tareaHijaId: string;
  madre: string;
  hija: string;
  accionMadre: string;
  componente: string;
  repeticiones: number;
  periodoDias: number | null;
  especialidad: string | null;
  horasEstimadas: number | null;
  activo: boolean;
  desde: string | null;
  vueltaDesde: number | null;
  /** Ya calculada en el servidor con `loQueHaraElCiclo`. */
  decision: Decision;
}

export interface ProgramadoDeLaSeccion {
  id: string;
  equipo: string;
  cadaCuanto: string;
  proxima: string | null;
  estado: string;
}

/**
 * Los dos motores de OT automáticas, en un lugar.
 *
 * ── POR QUÉ ESTA SECCIÓN EXISTE ────────────────────────────────────────────
 *
 * El 24/11/2026 un ciclo generó 426 órdenes en cuatro días, y para frenarlo
 * hubo que escribir `activo = false` en la base a mano: el único freno de un
 * mecanismo que escribe en la planilla de producción estaba fuera de la
 * aplicación. Los cuatro ciclos los había plantado la semilla de una
 * migración y sus parámetros no tenían pantalla ninguna.
 *
 * ── POR QUÉ EL ESTADO SE VE PERO NO SE TOCA ACÁ ────────────────────────────
 *
 * El último trabajo, la vuelta y el botón «se cambiaron los martillos» son
 * **operativos**: registran un hecho físico, y viven en la ficha del equipo
 * para que quien está parado frente a la máquina los pueda desmentir. Acá se
 * ven y se enlazan; no se reemplazan.
 *
 * ── Y POR QUÉ UN CICLO APAGADO SE SIGUE VIENDO ─────────────────────────────
 *
 * Porque uno escondido es indistinguible de uno que no existe. Lo mismo vale
 * para el que no arrancó: lo dice con todas las letras en vez de quedarse
 * callado, que es como un ciclo dormido se queda dormido para siempre.
 */
export default function LoQueCreaOrdenesSolo({
  ciclos, programados,
}: {
  ciclos: CicloDeLaSeccion[];
  programados: ProgramadoDeLaSeccion[];
}) {
  return (
    <div className="card space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Lo que crea órdenes solo</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Las órdenes de trabajo que el sistema crea sin que nadie las cargue. Acá se ve qué
          va a generar cada una y con qué plazos.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Ciclos encadenados
        </h3>

        {ciclos.length === 0 ? (
          <p className="text-sm text-slate-500">No hay ningún ciclo configurado.</p>
        ) : (
          ciclos.map((c) => <TarjetaDeCiclo key={c.id} ciclo={c} />)
        )}
      </div>

      <LosProgramados programados={programados} />
    </div>
  );
}

function TarjetaDeCiclo({ ciclo }: { ciclo: CicloDeLaSeccion }) {
  const arrancado = ciclo.desde !== null && ciclo.vueltaDesde !== null;
  const equipo = [ciclo.equipoCode, ciclo.equipoNombre].filter(Boolean).join(" – ") || "—";

  return (
    <div
      className={`rounded-lg border border-slate-200 px-4 py-3 ${ciclo.activo ? "" : "opacity-60"}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link
            href={`/mantenimiento/equipos/${ciclo.equipoId}`}
            className="text-sm font-semibold text-slate-800 hover:underline"
          >
            {equipo}
          </Link>
          <p className="text-xs text-slate-500">
            {ciclo.hija} × {ciclo.repeticiones}, y después {ciclo.madre.toLowerCase()}
          </p>
        </div>
        {!ciclo.activo && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            Apagado, no genera órdenes
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Cada cuánto</dt>
          <dd className="text-sm font-medium text-slate-800">
            {ciclo.periodoDias ? `${ciclo.periodoDias} días` : "sin plazo cargado"}
          </dd>
          <dd className="text-xs text-slate-500">de «{ciclo.hija}»</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Especialidad</dt>
          <dd className="text-sm font-medium text-slate-800">{ciclo.especialidad ?? "—"}</dd>
          <dd className="text-xs text-slate-500">
            {ciclo.horasEstimadas === null ? "sin horas estimadas" : `${ciclo.horasEstimadas} h estimadas`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Último trabajo</dt>
          {arrancado ? (
            <>
              <dd className="text-sm font-medium text-slate-800">
                {ciclo.vueltaDesde === 0
                  ? ciclo.madre
                  : `${ciclo.hija} — a ${caraDeLaVuelta(ciclo.vueltaDesde!)} cara`}
              </dd>
              <dd className="text-xs text-slate-500">el {comoSeLee(ciclo.desde!)}</dd>
            </>
          ) : (
            <dd className="text-sm text-slate-500">Todavía ninguno</dd>
          )}
        </div>
      </dl>

      <p className="mt-3 border-t border-slate-100 pt-2 text-sm text-slate-700">
        <span className="text-xs uppercase tracking-wide text-slate-400">Ahora mismo: </span>
        {comoSeLeeLaDecision(ciclo.decision, { madre: ciclo.madre, hija: ciclo.hija })}
      </p>

      {!arrancado && !arrancaSolo(ciclo.accionMadre, ciclo.componente) && (
        <p className="mt-2 text-xs text-amber-700">
          Este ciclo <strong>no arranca solo</strong>: hay que arrancarlo{" "}
          <Link href={`/mantenimiento/equipos/${ciclo.equipoId}`} className="underline">
            desde la ficha del equipo
          </Link>{" "}
          cuando se haga el primer {ciclo.madre.toLowerCase()}. El arranque automático
          reconoce trabajos escritos como un reemplazo de la pieza, y éste no lo es.
        </p>
      )}
    </div>
  );
}

/**
 * El otro motor. Se lista y se enlaza, no se edita acá: su pantalla tiene alta,
 * edición, filtros y pausa andando, y rehacerlo adentro de Configuración sería
 * un segundo lugar donde tocar lo mismo.
 */
function LosProgramados({ programados }: { programados: ProgramadoDeLaSeccion[] }) {
  return (
    <div className="space-y-2 border-t border-slate-100 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Mantenimientos programados
        </h3>
        <Link href="/mantenimiento/mantenimientos" className="text-xs text-blue-700 hover:underline">
          Administrarlos →
        </Link>
      </div>

      {programados.length === 0 ? (
        <p className="text-sm text-slate-500">
          No hay ninguno cargado, así que este motor no está generando nada.
        </p>
      ) : (
        <ul className="space-y-1">
          {programados.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-slate-700">
              <span className="font-medium">{p.equipo}</span>
              <span className="text-xs text-slate-500">{p.cadaCuanto}</span>
              <span className="text-xs text-slate-500">
                · próxima {p.proxima ? comoSeLee(p.proxima) : "sin fecha"}
              </span>
              <span className="text-xs text-slate-500">· {p.estado}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
