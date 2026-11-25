"use client";

import { useState } from "react";
import Link from "next/link";
import Select from "@/components/Select";
import { Modal } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmProvider";
import { comoSeLee } from "@/lib/core/fechas";
import { claveDelBorrador } from "@/lib/core/borradorDeFormulario";
import { useBorrador } from "@/lib/core/useBorrador";
import { caraDeLaVuelta, type Decision } from "@/lib/mantenimiento/cicloDeOT";
import {
  arrancaSolo, comoSeLeeLaDecision, loQueFaltaParaArmar,
} from "@/lib/mantenimiento/configurarElCiclo";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import { ACCIONES_PREVENTIVAS } from "@/lib/mantenimiento/tareasPreventivas";

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
  /** Las confirmadas del catálogo para ese equipo: lo que se le puede poner. */
  tareasDelEquipo: { id: string; nombre: string }[];
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

/** Lo que el alta necesita saber y no sale de los ciclos que ya existen. */
export interface ParaArmarUnCiclo {
  /** Los activos **sin** ciclo: `unique (equipment_id)` admite uno solo. */
  equipos: { id: string; etiqueta: string }[];
  /** Los relevados, por equipo. 62 de los 269 equipos no tienen ninguno. */
  componentes: Record<string, string[]>;
  /** El catálogo entero, para reusar una tarea en vez de duplicarla. */
  tareas: {
    equipment_id: string;
    accion: string;
    componente: string;
    nombre: string;
    periodo_dias: number | null;
    estado: string;
  }[];
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
  ciclos, programados, paraArmar, puedeEditar, llamar,
}: {
  ciclos: CicloDeLaSeccion[];
  programados: ProgramadoDeLaSeccion[];
  paraArmar: ParaArmarUnCiclo;
  puedeEditar: boolean;
  llamar: Llamar;
}) {
  const [armando, setArmando] = useState(false);

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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Ciclos encadenados
          </h3>
          {puedeEditar && (
            <button type="button" className="btn-secondary text-xs" onClick={() => setArmando(true)}>
              Armar un ciclo
            </button>
          )}
        </div>

        {ciclos.length === 0 ? (
          <p className="text-sm text-slate-500">No hay ningún ciclo configurado.</p>
        ) : (
          ciclos.map((c) => (
            <TarjetaDeCiclo key={c.id} ciclo={c} puedeEditar={puedeEditar} llamar={llamar} />
          ))
        )}
      </div>

      {armando && (
        <ArmarUnCiclo
          paraArmar={paraArmar}
          llamar={llamar}
          alCerrar={() => setArmando(false)}
        />
      )}

      <LosProgramados programados={programados} />
    </div>
  );
}

/** Las dos mitades de un ciclo, con el rótulo que lleva cada una en pantalla. */
const LADOS = [
  { lado: "Hija", titulo: "La tarea que se repite", ejemplo: "Rotación de Martillos" },
  { lado: "Madre", titulo: "La tarea que cierra el ciclo", ejemplo: "Cambio de Martillos" },
] as const;

/** El texto que una persona escribiría para esa acción sobre ese componente. */
function nombreSugerido(clave: string, componente: string): string {
  const accion = ACCIONES_PREVENTIVAS.find((a) => a.clave === clave);
  if (!accion || !componente) return "";

  return `${accion.corta.charAt(0).toUpperCase()}${accion.corta.slice(1)} ${componente}`;
}

/**
 * Armar un ciclo nuevo.
 *
 * ── POR QUÉ UN SOLO COMPONENTE PARA LAS DOS TAREAS ─────────────────────────
 *
 * Porque un ciclo encadenado es siempre el mismo componente visto dos veces:
 * se rota la pieza hasta que se le acaban las caras y entonces se la cambia.
 * Dos componentes distintos no serían un ciclo sino dos planes, que es lo que
 * hacen los mantenimientos programados.
 *
 * Esa es también la razón de que las dos acciones no puedan ser la misma: la
 * clave de una tarea del catálogo es `(equipo, acción, componente)`, así que
 * con el componente compartido dos acciones iguales resuelven a la misma fila
 * y el ciclo nacería apuntándose a sí mismo.
 *
 * ── POR QUÉ REUSA UNA TAREA EN VEZ DE CREARLA SIEMPRE ──────────────────────
 *
 * Porque el catálogo ya es de alguien: `/mantenimiento/tareas-preventivas` es
 * donde se confirma qué tareas tiene un equipo, y duplicarlas desde acá
 * dejaría dos filas para el mismo trabajo. Si la tarea ya está, el alta la
 * muestra y deja editarle el nombre y el plazo.
 */
function ArmarUnCiclo({
  paraArmar, llamar, alCerrar,
}: {
  paraArmar: ParaArmarUnCiclo;
  llamar: Llamar;
  alCerrar: () => void;
}) {
  const confirmar = useConfirm();
  const [guardando, setGuardando] = useState(false);
  const [problemas, setProblemas] = useState<string[]>([]);

  const { valores, cambiar, tocado, tirar } = useBorrador(
    claveDelBorrador("armar-ciclo"),
    {
      equipment_id: "", componente: "", componenteLibre: "",
      accionHija: "ROTACION", nombreHija: "",
      accionMadre: "CAMBIO", nombreMadre: "",
      periodo_dias: "", repeticiones: "3",
      especialidad: "", horas_estimadas: "",
    },
  );

  const relevados = paraArmar.componentes[valores.equipment_id] ?? [];
  // «otro…» no es un componente: es la puerta al campo de texto, que es lo que
  // usan los 62 equipos sin ninguno relevado.
  const componente = (
    valores.componente === "__otro__" ? valores.componenteLibre : valores.componente
  ).trim();

  /** La fila del catálogo que ese par ya tiene, si la tiene. */
  const yaExiste = (accion: string) =>
    paraArmar.tareas.find(
      (t) => t.equipment_id === valores.equipment_id &&
        t.accion === accion &&
        t.componente.trim().toLowerCase() === componente.toLowerCase()
    );

  /** Lo que se va a mandar: lo tipeado, y si está vacío lo sugerido. */
  const nombreDe = (lado: "Madre" | "Hija") => {
    const tipeado = (lado === "Madre" ? valores.nombreMadre : valores.nombreHija).trim();
    if (tipeado) return tipeado;

    const accion = lado === "Madre" ? valores.accionMadre : valores.accionHija;
    return yaExiste(accion)?.nombre ?? nombreSugerido(accion, componente);
  };

  const plazoDeLaHija = valores.periodo_dias.trim() ||
    String(yaExiste(valores.accionHija)?.periodo_dias ?? "");

  const alta = {
    equipment_id: valores.equipment_id,
    componente,
    accionMadre: valores.accionMadre,
    nombreMadre: nombreDe("Madre"),
    accionHija: valores.accionHija,
    nombreHija: nombreDe("Hija"),
    periodo_dias: plazoDeLaHija === "" ? undefined : Number(plazoDeLaHija),
    repeticiones: valores.repeticiones.trim() === "" ? undefined : Number(valores.repeticiones),
    especialidad: valores.especialidad || null,
    horas_estimadas: valores.horas_estimadas.trim() === ""
      ? null
      : Number(valores.horas_estimadas),
  };

  async function guardar() {
    const falta = loQueFaltaParaArmar(alta);
    setProblemas(falta);
    if (falta.length > 0) return;

    // El arranque automático reconoce trabajos escritos como un reemplazo de
    // la pieza. Si la madre no lo es, el ciclo nace dormido — y un ciclo
    // dormido no genera nada y nada lo avisa, así que se dice antes.
    if (!arrancaSolo(valores.accionMadre, componente)) {
      const sigue = await confirmar({
        title: "Este ciclo no va a arrancar solo",
        message:
          `«${alta.nombreMadre}» no se lee como un reemplazo de la pieza, así que el ` +
          `arranque automático no lo va a reconocer. El ciclo se puede armar igual, pero ` +
          `hay que arrancarlo a mano desde la ficha del equipo cuando se haga el primero.`,
        confirmText: "Armarlo igual",
      });
      if (!sigue) return;
    }

    setGuardando(true);
    const ok = await llamar("/api/mantenimiento/ciclos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    setGuardando(false);

    // Sale bien y cierra: `tirar()` y no `asentar()`, porque el formulario se
    // vuelve a montar la próxima vez que se abra.
    if (ok) {
      tirar();
      alCerrar();
    }
  }

  return (
    <Modal titulo="Armar un ciclo" alSalir={alCerrar} tocado={tocado} ancho="ancho">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Una tarea que se repite unas cuantas veces y, cuando se le acaban las vueltas, otra
          que cierra el ciclo y lo vuelve a empezar. La más cargada: rotar los martillos tres
          veces y después cambiarlos.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Equipo</label>
            <Select
              className="input"
              value={valores.equipment_id}
              onChange={(e) => cambiar({ equipment_id: e.target.value, componente: "" })}
            >
              <option value="">Elegir…</option>
              {paraArmar.equipos.map((e) => (
                <option key={e.id} value={e.id}>{e.etiqueta}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-400">
              Sólo los que todavía no tienen ciclo: cada equipo puede tener uno.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Componente</label>
            {relevados.length > 0 ? (
              <Select
                className="input"
                value={valores.componente}
                onChange={(e) => cambiar({ componente: e.target.value })}
              >
                <option value="">Elegir…</option>
                {relevados.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value="__otro__">otro…</option>
              </Select>
            ) : (
              <input
                className="input"
                placeholder="Martillos"
                value={valores.componenteLibre}
                onChange={(e) =>
                  cambiar({ componente: "__otro__", componenteLibre: e.target.value })
                }
              />
            )}
            {relevados.length > 0 && valores.componente === "__otro__" && (
              <input
                className="input mt-1"
                placeholder="Martillos"
                value={valores.componenteLibre}
                onChange={(e) => cambiar({ componenteLibre: e.target.value })}
              />
            )}
            <p className="mt-1 text-xs text-slate-400">
              La misma pieza para las dos tareas: se rota hasta gastarla y después se cambia.
            </p>
          </div>
        </div>

        {LADOS.map(({ lado, titulo, ejemplo }) => {
          const accion = lado === "Madre" ? valores.accionMadre : valores.accionHija;
          const existente = yaExiste(accion);

          return (
            <div key={lado} className="rounded-lg border border-slate-200 p-3">
              <h4 className="text-xs font-semibold text-slate-700">{titulo}</h4>

              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Qué se hace</label>
                  <Select
                    className="input"
                    value={accion}
                    onChange={(e) => cambiar(
                      lado === "Madre"
                        ? { accionMadre: e.target.value }
                        : { accionHija: e.target.value }
                    )}
                  >
                    {ACCIONES_PREVENTIVAS.map((a) => (
                      <option key={a.clave} value={a.clave}>{a.etiqueta}</option>
                    ))}
                  </Select>
                </div>

                <div className={lado === "Hija" ? "" : "sm:col-span-2"}>
                  <label className="mb-1 block text-xs text-slate-500">Cómo se llama</label>
                  <input
                    className="input"
                    placeholder={ejemplo}
                    value={nombreDe(lado)}
                    onChange={(e) => cambiar(
                      lado === "Madre"
                        ? { nombreMadre: e.target.value }
                        : { nombreHija: e.target.value }
                    )}
                  />
                </div>

                {lado === "Hija" && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Cada cuántos días</label>
                    <input
                      type="number" min={1} max={3650} className="input"
                      value={plazoDeLaHija}
                      onChange={(e) => cambiar({ periodo_dias: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {existente && (
                <p className="mt-2 text-xs text-slate-500">
                  Ese equipo ya tiene «{existente.nombre}» en el catálogo
                  {existente.periodo_dias ? `, cada ${existente.periodo_dias} días` : ""}: el
                  ciclo la reusa.{" "}
                  {existente.estado === "DESCARTADA" && (
                    <span className="text-amber-700">
                      Estaba descartada, y armar el ciclo la vuelve a confirmar.
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Veces antes de cerrar
            </label>
            <input
              type="number" min={1} max={20} className="input"
              value={valores.repeticiones}
              onChange={(e) => cambiar({ repeticiones: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Especialidad</label>
            <Select
              className="input"
              value={valores.especialidad}
              onChange={(e) => cambiar({ especialidad: e.target.value })}
            >
              <option value="">Sin especialidad</option>
              {ESPECIALIDADES.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Horas estimadas
            </label>
            <input
              type="number" min={0} step="0.5" className="input"
              value={valores.horas_estimadas}
              onChange={(e) => cambiar({ horas_estimadas: e.target.value })}
            />
          </div>
        </div>

        {problemas.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-700">
            {problemas.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}

        <p className="text-xs text-slate-500">
          El ciclo nace <strong>sin arrancar</strong>: no genera ninguna orden hasta que se
          haga el primer {nombreDe("Madre").toLowerCase() || "trabajo que lo dispare"}.
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => { tirar(); alCerrar(); }}>
            Descartar
          </button>
          <button type="button" className="btn-primary" disabled={guardando} onClick={guardar}>
            {guardando ? "Armando…" : "Armar el ciclo"}
          </button>
        </div>
      </div>
    </Modal>
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

      {puedeEditar && <CambiarLasTareas ciclo={ciclo} guardar={guardar} />}

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
 * Cambiar el par de tareas de un ciclo, que lo devuelve a «sin arrancar».
 *
 * ── POR QUÉ ESTO EXISTE ────────────────────────────────────────────────────
 *
 * Porque si no, no hay salida: `unique (equipment_id)` admite un ciclo por
 * equipo, no hay botón de borrar, y el alta no ofrece equipos que ya tengan
 * uno. Sin esto, un equipo cuyo ciclo se apagó no podría tener otro nunca.
 *
 * Va plegado detrás de un resumen porque es lo más destructivo de la tarjeta y
 * lo que menos se usa, y la confirmación dice **qué se pierde**, con el dato
 * concreto: `desde` y `vuelta_desde` describen el par viejo y no se pueden
 * traducir a otro.
 */
function CambiarLasTareas({
  ciclo, guardar,
}: {
  ciclo: CicloDeLaSeccion;
  guardar: (cambio: Record<string, unknown>) => Promise<boolean>;
}) {
  const confirmar = useConfirm();
  const arrancado = ciclo.desde !== null && ciclo.vueltaDesde !== null;

  async function cambiar(cambio: { tarea_madre_id?: string; tarea_hija_id?: string }) {
    const queSePierde = arrancado
      ? `El ciclo va a quedar sin arrancar: se pierde que el último trabajo fue ` +
        `${ciclo.vueltaDesde === 0 ? ciclo.madre : `${ciclo.hija} a ${caraDeLaVuelta(ciclo.vueltaDesde!)} cara`}` +
        ` el ${comoSeLee(ciclo.desde!)}, porque eso describe las tareas viejas y no se puede traducir.`
      : "El ciclo todavía no arrancó, así que no se pierde ningún estado.";

    if (!(await confirmar({
      title: "Cambiar las tareas del ciclo",
      message: `${queSePierde}\n\nVa a arrancar de nuevo con el próximo trabajo que lo dispare, o a mano desde la ficha del equipo.`,
      confirmText: "Cambiarlas",
      danger: arrancado,
    }))) return;

    await guardar(cambio);
  }

  if (ciclo.tareasDelEquipo.length < 2) {
    return (
      <p className="mt-2 text-xs text-slate-400">
        Para cambiarle las tareas a este ciclo hace falta tener al menos dos confirmadas para
        este equipo en el catálogo.
      </p>
    );
  }

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-900">
        Cambiarle las tareas
      </summary>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            La que se repite
          </label>
          <Select
            value={ciclo.tareaHijaId}
            className="input"
            onChange={(e) => cambiar({ tarea_hija_id: e.target.value })}
          >
            {ciclo.tareasDelEquipo.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            La que cierra el ciclo
          </label>
          <Select
            value={ciclo.tareaMadreId}
            className="input"
            onChange={(e) => cambiar({ tarea_madre_id: e.target.value })}
          >
            {ciclo.tareasDelEquipo.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </Select>
        </div>
      </div>
    </details>
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
