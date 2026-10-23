"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fecha } from "@/lib/compras/constants";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";
import type { Aviso } from "@/lib/mantenimiento/types";
import NuevoAvisoModal from "./NuevoAvisoModal";
import GenerarOTModal, { type EquipoDelAviso } from "./GenerarOTModal";
import DesestimarModal from "./DesestimarModal";
import EnlazarOTModal from "./EnlazarOTModal";
import Select from "@/components/Select";
import { finalDelAviso, estaDesestimado } from "@/lib/mantenimiento/desestimarAviso";
import type { SectorDePlanta } from "@/lib/mantenimiento/sectores";

/**
 * Los avisos: lo que alguien reportó que necesita mantenimiento.
 *
 * Es el primer eslabón del módulo. De acá salen las órdenes de trabajo, y por
 * eso lo que importa de la pantalla son los avisos que todavía no tienen una:
 * cada uno es algo que alguien vio y nadie tomó.
 */
export default function AvisosClient({
  avisos, puedeEditar, sync, sectores, equipos, areas, areaInicial, quienAviso,
}: {
  /** Para el alta de un aviso: ver `NuevoAvisoModal`. */
  areas: { id: string; nombre: string }[];
  areaInicial: string;
  quienAviso: string;
  avisos: Aviso[];
  puedeEditar: boolean;
  /** Cuándo se trajo por última vez lo de la planilla. */
  sync: UltimaSync | null;
  /** Para poder corregir a qué máquina es la OT antes de crearla. */
  sectores: SectorDePlanta[];
  equipos: EquipoDelAviso[];
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [urgencia, setUrgencia] = useState("");
  const [soloSinOt, setSoloSinOt] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);

  /**
   * `?nuevo=1` abre el alta con los campos que vengan en la URL. Lo usa el
   * asistente: arma la intención, y la pantalla hace lo de siempre.
   *
   * Se lee una sola vez al montar, de `window.location.search` y no del hook:
   * al volver con el botón de atrás, `useSearchParams()` devuelve la URL vieja.
   * Es la misma razón que está escrita en `lib/core/usarLaUrl.ts`.
   */
  const [arranqueDelAlta] = useState(() => {
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search
    );
    if (params.get("nuevo") !== "1") return null;
    return {
      equipo: params.get("equipo") ?? undefined,
      descripcion: params.get("descripcion") ?? undefined,
      urgencia: params.get("urgencia") ?? undefined,
    };
  });
  const [creando, setCreando] = useState(arranqueDelAlta !== null);

  /**
   * En qué terminó cada aviso: con OT, desestimado, o todavía pendiente.
   *
   * Son tres desde el 21/10/2026. Antes eran dos, y por eso la lista de
   * pendientes mezclaba lo que falta hacer con lo que ya se decidió no hacer:
   * de 183 avisos había 5 sin OT, y dos eran de julio y septiembre.
   *
   * La decisión vive en `lib/mantenimiento/desestimarAviso.ts` con sus tests,
   * incluida la regla de que tener OT gana sobre estar desestimado.
   */
  const tieneOt = (a: Aviso) => finalDelAviso(a) === "con-ot";
  const estaPendiente = (a: Aviso) => finalDelAviso(a) === "pendiente";

  // La urgencia viene con emoji desde la planilla —"🔴 Alta"—, así que las
  // opciones salen de los datos y no de una lista fija que quedaría corta.
  const urgencias = useMemo(
    () => [...new Set(avisos.map((a) => a.urgencia).filter((u): u is string => Boolean(u)))].sort(),
    [avisos]
  );

  const visibles = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return avisos.filter((a) => {
      if (urgencia && a.urgencia !== urgencia) return false;
      // "Sin OT" quiere decir PENDIENTE: un aviso desestimado tampoco tiene
      // orden, pero ya se decidio que no la va a tener, asi que mostrarlo aca
      // devuelve a la lista justo lo que esta funcion vino a sacar.
      if (soloSinOt && !estaPendiente(a)) return false;
      if (!q) return true;
      return [a.oa_number, a.descripcion, a.equipo_raw, a.sector_raw, a.quien_aviso]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [avisos, busqueda, urgencia, soloSinOt]);

  async function sincronizar() {
    setSincronizando(true);
    setError("");
    setResultado(null);

    const res = await fetch("/api/mantenimiento/avisos/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo sincronizar.");
      return;
    }
    setResultado(
      `Se leyeron ${body.leidas} filas y se guardaron ${body.guardados} avisos.` +
      (body.sin_equipo > 0
        ? ` ${body.sin_equipo} no se pudieron enlazar a un equipo del sistema.`
        : "") +
      (body.numeros_repetidos?.length
        ? ` Ojo: la planilla tiene dos filas con el N° ${body.numeros_repetidos.join(", ")}` +
          ` — se guardó la de más abajo. Corregilo en la planilla.`
        : "")
    );
    router.refresh();
  }

  /**
   * De un aviso sale una orden de trabajo.
   *
   * La OT nace correctiva —alguien reportó una falla, no es un preventivo
   * programado— y con la prioridad que le corresponde a la urgencia del aviso.
   * El aviso queda apuntando a ella para que nadie genere una segunda.
   *
   * **Abre un formulario en vez de crearla de una**, desde el 21/10/2026.
   * Hasta ese día mandaba el cuerpo directo, con seis campos; el 19/10 una OT
   * nueva pasó a exigir siete —entre ellos la especialidad, quién la hace y la
   * fecha de ejecución, que un aviso no dice— y desde entonces este botón
   * contestaba «Falta cargar la especialidad, quién lo realiza, la fecha de
   * ejecución» y no generaba nada.
   *
   * Lo que el aviso sí sabe no se vuelve a preguntar, y qué falta preguntar lo
   * decide la misma regla que corre el servidor: ver
   * `lib/mantenimiento/otDesdeAviso.ts`.
   */
  const [generarDe, setGenerarDe] = useState<Aviso | null>(null);
  const [desestimarA, setDesestimarA] = useState<Aviso | null>(null);

  /**
   * El tercer final de un aviso pendiente: la orden ya existe.
   *
   * El encargado del area se adelanta —ve la falla, carga la OT por su lado— y
   * el aviso que alguien habia reportado queda pendiente para siempre aunque
   * el trabajo ya este andando. Hasta el 23/10/2026 la unica forma de decirlo
   * era escribir el numero a mano en la planilla y esperar la sincronizacion.
   *
   * No crea nada ni toca la orden: ver `lib/mantenimiento/enlazarOtAlAviso.ts`.
   */
  const [enlazarA, setEnlazarA] = useState<Aviso | null>(null);

  /**
   * Volver a dejarlo pendiente.
   *
   * Desestimar no es irreversible —por eso tampoco se audita—, y sin esto la
   * unica forma de deshacerlo seria editar la base a mano.
   */
  async function retomar(aviso: Aviso) {
    setError(""); setResultado(null);
    const res = await fetch(`/api/mantenimiento/avisos/desestimar?id=${aviso.id}`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error ?? "No se pudo retomar el aviso."); return; }
    setResultado(
      `El aviso ${aviso.oa_number} vuelve a estar pendiente.` +
      (body.planilla_error ? ` Ojo: ${body.planilla_error}` : "")
    );
    router.refresh();
  }

  function generarOT(aviso: Aviso) {
    setError("");
    setResultado(null);
    setGenerarDe(aviso);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-xl font-bold text-slate-900">Avisos</h1>
            <UltimaSincronizacion
              cuando={sync?.created_at}
              ok={sync?.ok ?? true}
              error={sync?.error}
            />
          </div>
          <p className="text-sm text-slate-500">
            {visibles.length === avisos.length
              ? `${avisos.length} aviso${avisos.length === 1 ? "" : "s"}`
              : `${visibles.length} de ${avisos.length}`}
            {" · "}
            {avisos.filter(estaPendiente).length} sin orden de trabajo
            {avisos.filter(estaDesestimado).length > 0 &&
              ` · ${avisos.filter(estaDesestimado).length} desestimados`}
          </p>
        </div>

        {puedeEditar && (
          <div className="flex gap-2">
            <button
              onClick={sincronizar}
              disabled={sincronizando}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {sincronizando ? "Trayendo…" : "Traer de la planilla"}
            </button>
            <button
              onClick={() => setCreando(true)}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Nuevo aviso
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {resultado && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {resultado}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por equipo, sector, descripción…"
          className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <Select
          value={urgencia}
          onChange={(e) => setUrgencia(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Cualquier urgencia</option>
          {urgencias.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloSinOt}
            onChange={(e) => setSoloSinOt(e.target.checked)}
          />
          Sin orden de trabajo
        </label>
      </div>

      {avisos.length === 0 ? (
        <p className="card px-5 py-8 text-center text-sm text-slate-400">
          Todavía no hay avisos. {puedeEditar && "Traelos de la planilla con el botón de arriba."}
        </p>
      ) : (
        <>
        {/* En un teléfono, tarjetas. Esta es la pantalla que se abre parado
            frente a la máquina, así que el equipo va primero y grande: es el
            dato con el que la persona reconoce si el aviso es el suyo. */}
        <div className="space-y-2 md:hidden">
          {visibles.map((a) => (
            <article key={a.id} className="card p-3">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-slate-900">
                  {a.equipos?.name ?? a.equipo_raw ?? "Sin equipo"}
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {a.oa_number ? `OA ${a.oa_number}` : "sin N°"}
                </span>
              </div>

              <p className="text-sm leading-snug text-slate-700">{a.descripcion ?? "—"}</p>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span>{a.sectores?.nombre ?? a.sector_raw ?? "Sin sector"}</span>
                {!a.equipment_id && a.equipo_raw && (
                  <span className="text-amber-700">· sin enlazar</span>
                )}
                {a.urgencia && <span>· {a.urgencia}</span>}
                <span>· {fecha(a.fecha)}</span>
                {a.quien_aviso && <span>· avisó {a.quien_aviso}</span>}
              </div>

              <div className="mt-2.5 border-t border-slate-100 pt-2.5">
                {tieneOt(a) ? (
                  <span className="text-xs text-slate-500">
                    {a.ot_asignada ? `OT #${a.ot_asignada}` : "Ya tiene OT"}
                  </span>
                ) : estaDesestimado(a) ? (
                  <Desestimado aviso={a} puedeEditar={puedeEditar} onRetomar={retomar} />
                ) : puedeEditar ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => generarOT(a)}
                      className="flex-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
                    >
                      Generar OT
                    </button>
                    <button
                      onClick={() => { setError(""); setResultado(null); setEnlazarA(a); }}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600"
                    >
                      Ya tiene OT
                    </button>
                    <button
                      onClick={() => setDesestimarA(a)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600"
                    >
                      No va
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-amber-700">Pendiente de OT</span>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="hidden overflow-x-auto card md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">N° OA</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Equipo</th>
                <th className="px-3 py-2 text-left">Qué pasa</th>
                <th className="px-3 py-2 text-left">Urgencia</th>
                <th className="px-3 py-2 text-left">Avisó</th>
                <th className="px-3 py-2 text-left">OT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-mono text-xs">{a.oa_number ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{fecha(a.fecha)}</td>
                  <td className="px-3 py-2">
                    <div>{a.equipos?.name ?? a.equipo_raw ?? "—"}</div>
                    <div className="text-xs text-slate-400">
                      {a.sectores?.nombre ?? a.sector_raw ?? ""}
                      {/* Sin equipo enlazado no se puede cruzar con su historial. */}
                      {!a.equipment_id && a.equipo_raw && " · sin enlazar"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{a.descripcion ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{a.urgencia ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{a.quien_aviso ?? "—"}</td>
                  <td className="px-3 py-2">
                    {tieneOt(a) ? (
                      <span className="text-xs text-slate-500">
                        {a.ot_asignada ? `OT #${a.ot_asignada}` : "sí"}
                      </span>
                    ) : estaDesestimado(a) ? (
                      <Desestimado aviso={a} puedeEditar={puedeEditar} onRetomar={retomar} />
                    ) : puedeEditar ? (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => generarOT(a)}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                        >
                          Generar OT
                        </button>
                        <button
                          onClick={() => { setError(""); setResultado(null); setEnlazarA(a); }}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Ya tiene OT
                        </button>
                        <button
                          onClick={() => setDesestimarA(a)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          No va
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-700">pendiente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {creando && (
        <NuevoAvisoModal
          inicial={arranqueDelAlta ?? undefined}
          quienAviso={quienAviso}
          areas={areas}
          areaInicial={areaInicial}
          onCerrar={() => setCreando(false)}
          onCreado={(oa) => {
            setCreando(false);
            setResultado(`Se cargó el aviso ${oa}.`);
            router.refresh();
          }}
        />
      )}

      {desestimarA && (
        <DesestimarModal
          aviso={desestimarA}
          onClose={() => setDesestimarA(null)}
          onHecho={(mensaje) => {
            setDesestimarA(null);
            setResultado(mensaje);
            router.refresh();
          }}
        />
      )}

      {enlazarA && (
        <EnlazarOTModal
          aviso={enlazarA}
          onClose={() => setEnlazarA(null)}
          onEnlazada={(mensaje) => {
            setEnlazarA(null);
            setResultado(mensaje);
            router.refresh();
          }}
        />
      )}

      {generarDe && (
        <GenerarOTModal
          aviso={generarDe}
          sectores={sectores}
          equipos={equipos}
          onClose={() => setGenerarDe(null)}
          onCreada={(mensaje) => {
            setGenerarDe(null);
            setResultado(mensaje);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * Un aviso que alguien decidió que no se hace.
 *
 * **Muestra el motivo y no sólo la palabra «desestimado».** Es la diferencia
 * entre esto y dejar el aviso pendiente para siempre: si la pantalla dijera
 * sólo que se descartó, dentro de tres meses nadie podría saber si fue una
 * decisión o un olvido, que es exactamente lo que había antes.
 */
function Desestimado({ aviso, puedeEditar, onRetomar }: {
  aviso: Aviso;
  puedeEditar: boolean;
  onRetomar: (a: Aviso) => void;
}) {
  return (
    <div className="text-xs">
      <span className="font-medium text-slate-500">No va a hacerse</span>
      {aviso.motivo_desestimado && (
        <span className="text-slate-400"> · {aviso.motivo_desestimado}</span>
      )}
      {puedeEditar && (
        <button
          onClick={() => onRetomar(aviso)}
          className="ml-2 text-slate-400 underline hover:text-slate-600"
        >
          retomar
        </button>
      )}
    </div>
  );
}
