"use client";

import { useState } from "react";
import Link from "next/link";
import Select from "@/components/Select";
import { comoSeLee } from "@/lib/core/fechas";
import { caraDeLaVuelta, type Decision } from "@/lib/mantenimiento/cicloDeOT";
import { arrancaSolo, comoSeLeeLaDecision } from "@/lib/mantenimiento/configurarElCiclo";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";

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

type Llamar = (url: string, o: RequestInit) => Promise<boolean>;

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
  ciclos, programados, puedeEditar, llamar,
}: {
  ciclos: CicloDeLaSeccion[];
  programados: ProgramadoDeLaSeccion[];
  puedeEditar: boolean;
  llamar: Llamar;
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
          ciclos.map((c) => (
            <TarjetaDeCiclo key={c.id} ciclo={c} puedeEditar={puedeEditar} llamar={llamar} />
          ))
        )}
      </div>

      <LosProgramados programados={programados} />
    </div>
  );
}

function TarjetaDeCiclo({
  ciclo, puedeEditar, llamar,
}: {
  ciclo: CicloDeLaSeccion;
  puedeEditar: boolean;
  llamar: Llamar;
}) {
  // Lo tipeado y todavía no guardado. Vive acá y no en `ciclo` porque la
  // página se vuelve a pintar entera con cada guardado.
  const [plazo, setPlazo] = useState<string | null>(null);
  const [vueltas, setVueltas] = useState<string | null>(null);
  const [horas, setHoras] = useState<string | null>(null);

  const arrancado = ciclo.desde !== null && ciclo.vueltaDesde !== null;
  const equipo = [ciclo.equipoCode, ciclo.equipoNombre].filter(Boolean).join(" – ") || "—";

  /** El plazo que se está mirando: lo tipeado si hay algo, si no lo guardado. */
  const plazoALaVista = plazo === null ? (ciclo.periodoDias ?? "") : plazo;

  const guardar = (cambio: Record<string, unknown>) =>
    llamar(`/api/mantenimiento/ciclos/${ciclo.id}/configuracion`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cambio),
    });

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

        {puedeEditar ? (
          <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={ciclo.activo}
              onChange={(e) => guardar({ activo: e.target.checked })}
            />
            Genera órdenes
          </label>
        ) : (
          !ciclo.activo && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              Apagado, no genera órdenes
            </span>
          )
        )}
      </div>

      {!ciclo.activo && puedeEditar && (
        <p className="mt-1 text-xs text-slate-500">Apagado: no genera ninguna orden.</p>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Cada cuánto</dt>
          <dd className="mt-0.5 flex items-center gap-2">
            {/* El ancho va en el `div` y no en el `input`: `.input` declara
                `width: 100%` fuera de toda capa y le gana a cualquier `w-*`. */}
            <div className="w-20 shrink-0">
              <input
                type="number" min={1} max={3650} className="input"
                aria-label={`Cada cuántos días de ${ciclo.hija}`}
                value={plazoALaVista}
                disabled={!puedeEditar}
                onChange={(e) => setPlazo(e.target.value)}
                onBlur={(e) => {
                  const texto = e.target.value.trim();
                  const n = texto === "" ? null : Number(texto);
                  if (n !== (ciclo.periodoDias ?? null)) guardar({ periodo_dias: n });
                }}
              />
            </div>
            <span className="text-xs text-slate-400">días</span>
          </dd>
          <dd className="text-xs text-slate-500">
            de «{ciclo.hija}», en{" "}
            <Link href="/mantenimiento/tareas-preventivas" className="underline">
              tareas preventivas
            </Link>
          </dd>
        </div>

        <div>
          <dt className="text-xs text-slate-500">Veces antes del {ciclo.madre.toLowerCase()}</dt>
          <dd className="mt-0.5 w-20">
            <input
              type="number" min={1} max={20} className="input"
              aria-label="Repeticiones"
              value={vueltas === null ? ciclo.repeticiones : vueltas}
              disabled={!puedeEditar}
              onChange={(e) => setVueltas(e.target.value)}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (n !== ciclo.repeticiones && Number.isInteger(n)) guardar({ repeticiones: n });
              }}
            />
          </dd>
          <dd className="mt-1 flex items-center gap-2">
            <div className="w-20 shrink-0">
              <input
                type="number" min={0} step="0.5" className="input"
                aria-label="Horas estimadas"
                value={horas === null ? (ciclo.horasEstimadas ?? "") : horas}
                disabled={!puedeEditar}
                onChange={(e) => setHoras(e.target.value)}
                onBlur={(e) => {
                  const texto = e.target.value.trim();
                  const n = texto === "" ? null : Number(texto);
                  if (n !== (ciclo.horasEstimadas ?? null)) guardar({ horas_estimadas: n });
                }}
              />
            </div>
            <span className="text-xs text-slate-400">horas estimadas</span>
          </dd>
        </div>

        <div>
          <dt className="text-xs text-slate-500">Especialidad</dt>
          <dd className="mt-0.5">
            <Select
              value={ciclo.especialidad ?? ""}
              disabled={!puedeEditar}
              aria-label="Especialidad"
              className="input"
              onChange={(e) => guardar({ especialidad: e.target.value || null })}
            >
              <option value="">Sin especialidad</option>
              {ESPECIALIDADES.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </Select>
          </dd>
          <dd className="mt-1 text-xs text-slate-500">
            Último trabajo:{" "}
            {arrancado
              ? `${ciclo.vueltaDesde === 0
                  ? ciclo.madre
                  : `${ciclo.hija} a ${caraDeLaVuelta(ciclo.vueltaDesde!)} cara`}, el ${comoSeLee(ciclo.desde!)}`
              : "todavía ninguno"}
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-slate-100 pt-2">
        <p className="text-sm text-slate-700">
          <span className="text-xs uppercase tracking-wide text-slate-400">Ahora mismo: </span>
          {comoSeLeeLaDecision(ciclo.decision, { madre: ciclo.madre, hija: ciclo.hija })}
        </p>
        <CuandoCaeLaSiguiente decision={ciclo.decision} plazo={Number(plazoALaVista) || null} />
      </div>

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
 * La línea que **sí** reacciona a lo que se tipea.
 *
 * «Ahora mismo» no se mueve al cambiar el plazo, y eso no es un descuido de la
 * pantalla sino cómo decide el ciclo: `queSigueEnElCiclo` devuelve `esperar`
 * apenas la última orden está abierta, **antes** de usar el valor de
 * `periodo_dias`. Los cuatro ciclos de hoy tienen una orden viva, así que sin
 * esta línea bajar el plazo de 6 a 1 no cambiaría una palabra en pantalla — y
 * la defensa contra tipear un número de más no existiría.
 *
 * No es una segunda definición de nada: es la misma aritmética que usa
 * `crearLaSiguiente`, el cierre más el período, dicha en condicional.
 */
function CuandoCaeLaSiguiente({
  decision, plazo,
}: {
  decision: Decision;
  plazo: number | null;
}) {
  if (!plazo) {
    return (
      <p className="mt-1 text-xs text-amber-700">
        Sin plazo el ciclo está detenido: no hay de dónde sacar la fecha de la orden siguiente.
      </p>
    );
  }

  const dias = `${plazo} ${plazo === 1 ? "día" : "días"}`;

  return (
    <p className="mt-1 text-xs text-slate-500">
      {decision.que === "esperar"
        ? `Al cerrarse la OT ${decision.ot}, la siguiente sería ${dias} después.`
        : `Cada orden del ciclo sale ${dias} después de que se cierre la anterior.`}
    </p>
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
