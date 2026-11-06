"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCargar } from "@/lib/core/useCargar";
import { createClient } from "@/lib/supabase/client";
import { fecha } from "@/lib/compras/constants";
import { finalDelAviso } from "@/lib/mantenimiento/desestimarAviso";
import type { Aviso } from "@/lib/mantenimiento/types";
import NuevoAvisoModal from "@/app/(app)/mantenimiento/avisos/NuevoAvisoModal";
import Select from "@/components/Select";

type Opcion = { id: string; nombre: string };

const POR_PAGINA = 50;

/**
 * Los avisos de mi área, y los de todos.
 *
 * Fuera del módulo Mantenimiento a propósito: quien ve una máquina rota trabaja
 * en Producción, en Cantera o en el laboratorio, y puede avisar y seguir el
 * aviso sin tener el módulo. Es la gemela de «Mis pedidos» y repite sus
 * decisiones.
 *
 * **De mi área, no míos.** Los 184 avisos que hay vinieron de la planilla y
 * ninguno trae quién los cargó en el sistema, así que filtrar por persona
 * dejaba esto vacío. El área sale de `quien_aviso` (ver
 * `lib/mantenimiento/areaDelAviso.ts`) o de lo que se eligió al cargarlo.
 *
 * **Un aviso sin área se muestra.** Hay 19 de 184 que no se pudieron resolver,
 * y esconderlos sería hacer desaparecer justo los que nadie va a encontrar por
 * área. Aparecen al mirar «Todos», con el hueco dicho en voz alta.
 *
 * **Acá no se decide nada.** No hay botón de generar la OT, ni de desestimar, ni
 * de sincronizar: eso sigue en `/mantenimiento/avisos`, que es de quien es la
 * decisión. Acá se avisa y se mira en qué terminó.
 *
 * La lista se arma en el cliente y pagina en el servidor: hoy son 184, pero
 * PostgREST corta en 1000 filas sin avisar, y el tablero de Compras parecía una
 * cola acotada y arrastra 1.900.
 */
export default function MisAvisosClient({
  usuarioId, misAreas, areas, areaInicial, quienAviso, tieneMantenimiento, urgencias,
}: {
  usuarioId: string;
  /** Los ids de las áreas de esta persona. Vacío = todavía no se le asignó. */
  misAreas: string[];
  areas: Opcion[];
  /** Con cuál arranca el alta: `""` si tiene cero o más de una. */
  areaInicial: string;
  quienAviso: string;
  /**
   * Si puede abrir `/mantenimiento/ordenes`. **Sin esto el número de OT va
   * pelado**: esa ruta rebota a `/` a quien no tiene el módulo, y son 10 de los
   * 14 usuarios —justo los destinatarios de esta pantalla—. Un enlace que
   * rebota es peor que no ponerlo; es la regla de `lib/core/nav.ts`.
   */
  tieneMantenimiento: boolean;
  /** Las que hay en los datos, con su emoji: no es una lista fija. */
  urgencias: string[];
}) {
  const router = useRouter();
  const [modalAbierto, setModalAbierto] = useState(false);

  // Arranca en el área propia, que es a lo que se entra. Salvo que no tenga
  // ninguna asignada: ahí una lista vacía sería un callejón, así que se abre en
  // todos y el cartel explica qué falta.
  const [alcance, setAlcance] = useState<"mios" | "todos">(
    misAreas.length > 0 ? "mios" : "todos"
  );
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [urgencia, setUrgencia] = useState("");
  const [pagina, setPagina] = useState(0);

  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // La búsqueda espera un momento para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Al cambiar un filtro se vuelve a la primera página, ajustado durante el
  // render y no en un efecto: ver la nota de `MisPedidosClient`.
  const filtro = `${alcance}|${busquedaAplicada}|${urgencia}`;
  const [filtroPrevio, setFiltroPrevio] = useState(filtro);
  if (filtro !== filtroPrevio) {
    setFiltroPrevio(filtro);
    setPagina(0);
  }

  // `useCargar` y no un efecto que llama y listo: descarta la respuesta que
  // llega tarde. Ver `lib/core/useCargar.ts`.
  const cargar = useCargar(async (vigente) => {
    setCargando(true);
    setError("");
    const supabase = createClient();

    let q = supabase
      .from("avisos")
      .select("*, equipos(name, code), sectores(nombre)", { count: "exact" });

    // Un `.in()` de nueve áreas como mucho: no es el de mil ids que arma una URL
    // que PostgREST rechaza.
    if (alcance === "mios") q = q.in("area_id", misAreas);
    if (urgencia) q = q.eq("urgencia", urgencia);

    if (busquedaAplicada) {
      const p = `%${busquedaAplicada.replace(/[%,()*\\]/g, " ")}%`;
      q = q.or(
        `oa_number.ilike.${p},descripcion.ilike.${p},equipo_raw.ilike.${p},` +
        `sector_raw.ilike.${p},quien_aviso.ilike.${p}`
      );
    }

    const desde = pagina * POR_PAGINA;
    const { data, count, error: err } = await q
      .order("fecha", { ascending: false, nullsFirst: false })
      // Desempate: muchos avisos comparten día, y sin un orden total el mismo
      // aviso puede caer en dos páginas o en ninguna.
      .order("id")
      .range(desde, desde + POR_PAGINA - 1);

    if (!vigente()) return;
    setCargando(false);
    if (err) { setError(err.message); setAvisos([]); return; }
    setAvisos((data ?? []) as Aviso[]);
    setTotal(count ?? 0);
  }, [alcance, busquedaAplicada, urgencia, pagina, misAreas]);

  const paginas = Math.ceil(total / POR_PAGINA);
  const nombreDeArea = (id: string | null) =>
    id ? areas.find((a) => a.id === id)?.nombre ?? null : null;
  /** De mi área. Es lo que se marca al mirar todos. */
  const esMio = (a: Aviso) => a.area_id !== null && misAreas.includes(a.area_id);
  /** Y este lo cargué yo en el sistema, que es otra cosa y también se dice. */
  const loCargueYo = (a: Aviso) => a.creado_por === usuarioId;

  const nombreDeMisAreas = areas
    .filter((a) => misAreas.includes(a.id))
    .map((a) => a.nombre)
    .join(" y ");

  const hayFiltro = Boolean(busquedaAplicada || urgencia);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {alcance === "mios" ? "Avisos de mi área" : "Todos los avisos"}
          </h1>
          <p className="text-sm text-slate-500">
            {alcance === "mios"
              ? `Lo que avisó ${nombreDeMisAreas || "tu área"} y en qué terminó.`
              : "Todos los avisos, de todas las áreas. Buscá acá antes de avisar."}
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          + Avisar de una falla
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-300">
          {(misAreas.length > 0 ? (["mios", "todos"] as const) : (["todos"] as const)).map((v) => (
            <button
              key={v}
              onClick={() => setAlcance(v)}
              className={`px-3 py-1.5 text-sm font-medium ${
                alcance === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v === "mios" ? "Mi área" : "Todos"}
            </button>
          ))}
        </div>

        {/* El buscador es la herramienta de «esto ya lo avisó alguien»: busca
            por equipo, sector, descripción, quién avisó y N° de aviso. */}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por equipo, descripción, N° de aviso…"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:max-w-sm"
        />

        <Select
          value={urgencia}
          onChange={(e) => setUrgencia(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">Cualquier urgencia</option>
          {urgencias.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>

        {!cargando && (
          <span className="text-xs text-slate-400">
            {total.toLocaleString("es-AR")} {total === 1 ? "aviso" : "avisos"}
          </span>
        )}
      </div>

      {/* Se dice **siempre** que falta el área, y no sólo cuando la lista está
          vacía: sin área esta pantalla abre en «Todos», que tiene los 184
          avisos, así que un cartel metido en la lista vacía no se veía nunca y
          10 de los 14 usuarios no tenían forma de saber por qué no hay «Mi
          área». Un cartel que sólo dice «no hay nada» manda a buscar el problema
          al lugar equivocado. */}
      {misAreas.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Todavía no tenés un área asignada.</p>
          <p className="mt-0.5 text-xs">
            Los avisos se agrupan por área. Pedile a un administrador que te asigne
            la tuya en Administración → Usuarios y vas a ver acá todo lo que avisó
            tu área.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-400">Cargando…</p>
      ) : avisos.length === 0 ? (
        <Vacio
          alcance={alcance}
          filtrando={hayFiltro}
          onVerTodos={() => setAlcance("todos")}
          onAvisar={() => setModalAbierto(true)}
        />
      ) : (
        <>
        {/* En un teléfono, tarjetas. Ocho columnas no entran, y esta es la
            pantalla que se abre parado frente a la máquina: el equipo va primero
            y grande, que es el dato con el que se reconoce si el aviso es el
            suyo, y en qué terminó va abajo, aparte. */}
        <div className="space-y-2 md:hidden">
          {avisos.map((a) => (
            <article key={a.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-slate-900">
                  {a.equipos?.name ?? a.equipo_raw ?? "Sin equipo"}
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {a.oa_number ? `OA ${a.oa_number}` : "sin N°"}
                </span>
                {alcance === "todos" && esMio(a) && (
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                    Mi área
                  </span>
                )}
                {loCargueYo(a) && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    Lo avisaste vos
                  </span>
                )}
              </div>

              <p className="text-sm leading-snug text-slate-700">{a.descripcion ?? "—"}</p>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span>{fecha(a.fecha)}</span>
                <span>· <Area nombre={nombreDeArea(a.area_id)} /></span>
                {a.quien_aviso && <span>· avisó {a.quien_aviso}</span>}
                {a.urgencia && <span>· {a.urgencia}</span>}
              </div>

              <div className="mt-2.5 border-t border-slate-100 pt-2.5 text-xs">
                <EnQueTermino aviso={a} tieneMantenimiento={tieneMantenimiento} />
              </div>
            </article>
          ))}
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">N° OA</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Qué pasa</th>
                  <th className="px-3 py-2 text-left">Equipo</th>
                  <th className="px-3 py-2 text-left">Área</th>
                  <th className="px-3 py-2 text-left">Avisó</th>
                  {/* "Sugerida": la eligió quien avisó, no es la prioridad con
                      la que Mantenimiento va a trabajar. Ver NuevoAvisoModal. */}
                  <th className="px-3 py-2 text-left">Urgencia sugerida</th>
                  <th className="px-3 py-2 text-left">En qué terminó</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {avisos.map((a) => (
                  <tr key={a.id} className={esMio(a) ? "bg-slate-50/70" : "hover:bg-slate-50"}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                      {a.oa_number ?? "—"}
                      {alcance === "todos" && esMio(a) && (
                        <span className="ml-1.5 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          Mi área
                        </span>
                      )}
                      {/* Que sea de mi área y que lo haya avisado yo son cosas
                          distintas: la primera dice si me toca, la segunda sirve
                          para seguir lo mío. */}
                      {loCargueYo(a) && (
                        <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          Vos
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(a.fecha)}</td>
                    <td className="max-w-sm px-3 py-2 text-slate-900">{a.descripcion ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div>{a.equipos?.name ?? a.equipo_raw ?? "—"}</div>
                      <div className="text-xs text-slate-400">
                        {a.sectores?.nombre ?? a.sector_raw ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <Area nombre={nombreDeArea(a.area_id)} />
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {a.quien_aviso ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{a.urgencia ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      <EnQueTermino aviso={a} tieneMantenimiento={tieneMantenimiento} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {paginas > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-slate-600">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="py-1">{pagina + 1} de {paginas}</span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
              disabled={pagina >= paginas - 1}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
        </>
      )}

      {modalAbierto && (
        <NuevoAvisoModal
          quienAviso={quienAviso}
          areas={areas}
          areaInicial={areaInicial}
          onCerrar={() => setModalAbierto(false)}
          onCreado={() => { setModalAbierto(false); cargar(); router.refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * El área del aviso, o el hueco dicho en voz alta.
 *
 * **«sin área» se muestra y no se esconde.** Son los avisos cuyo nombre no se
 * pudo resolver con certeza —19 de 184 al 22/10/2026— y `areaDelAviso.ts`
 * afirma que quedan a la vista. Un blanco se lee como «nadie lo asignó» y no como
 * «el sistema no pudo saberlo», y es lo que haría pasar de largo a esos 19.
 */
function Area({ nombre }: { nombre: string | null }) {
  return nombre
    ? <>{nombre}</>
    : <span className="italic text-amber-700">— sin área</span>;
}

/**
 * En qué terminó el aviso: con orden de trabajo, descartado, o pendiente.
 *
 * La decisión es `finalDelAviso()`, la misma que usa `/mantenimiento/avisos`,
 * con la regla de que tener OT le gana a estar desestimado. No hay una segunda
 * copia acá a propósito: dos pantallas diciendo cosas distintas del mismo aviso
 * es peor que una equivocada.
 *
 * Se muestra el motivo de un aviso descartado y no sólo la palabra: es lo que
 * le dice a quien avisó que alguien lo miró y por qué no se hizo nada.
 */
function EnQueTermino({
  aviso, tieneMantenimiento,
}: {
  aviso: Aviso;
  tieneMantenimiento: boolean;
}) {
  const final = finalDelAviso(aviso);

  if (final === "con-ot") {
    // `ot_asignada` es texto libre de la planilla: un número de OT en casi todos,
    // pero también «si», «Revision» y «-». Sólo un número se presenta como OT; lo
    // demás se muestra tal cual lo escribieron, sin interpretarlo.
    const crudo = String(aviso.ot_asignada ?? "").trim();
    if (/^\d+$/.test(crudo)) {
      return tieneMantenimiento ? (
        // Lleva al listado de órdenes ya buscando ese número: el buscador de
        // `/mantenimiento/ordenes` entiende `?q=` y compara contra `ot_number`.
        // `crudo` son sólo dígitos, así que no hace falta escaparlo.
        <Link
          href={`/mantenimiento/ordenes?q=${crudo}`}
          className="font-medium text-slate-700 underline"
        >
          OT #{crudo}
        </Link>
      ) : (
        <span className="font-medium text-slate-700">OT #{crudo}</span>
      );
    }
    if (crudo === "" || /^s[ií]$/i.test(crudo)) {
      return <span className="font-medium text-slate-700">Con orden de trabajo</span>;
    }
    return (
      <span className="text-slate-500">
        Con orden de trabajo · la planilla dice «{crudo}»
      </span>
    );
  }

  if (final === "desestimado") {
    return (
      <span>
        <span className="font-medium text-slate-500">No va a hacerse</span>
        {aviso.motivo_desestimado && (
          <span className="text-slate-400"> · {aviso.motivo_desestimado}</span>
        )}
      </span>
    );
  }

  return <span className="text-amber-700">Pendiente</span>;
}

/**
 * La lista vacía. **No habla de la falta de área**: sin área `alcance` nunca es
 * «mios», y el cartel que lo explica está arriba de la lista, donde se ve haya
 * o no resultados.
 */
function Vacio({
  alcance, filtrando, onVerTodos, onAvisar,
}: {
  alcance: "mios" | "todos";
  /** Hay una búsqueda o una urgencia puesta. */
  filtrando: boolean;
  onVerTodos: () => void;
  onAvisar: () => void;
}) {
  if (filtrando) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
        <p className="text-sm text-slate-500">
          Nada coincide con lo que buscaste
          {alcance === "mios" && " entre los avisos de tu área"}.
        </p>
        {alcance === "mios" && (
          <button onClick={onVerTodos} className="mt-2 text-sm text-slate-600 underline">
            Buscar entre todos los avisos
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
      <p className="text-sm text-slate-500">
        {alcance === "todos"
          ? "Todavía no hay avisos cargados."
          : "Tu área todavía no avisó de nada."}
      </p>
      {alcance === "mios" && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={onAvisar}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            Avisar de una falla
          </button>
          <button
            onClick={onVerTodos}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Ver todos los avisos
          </button>
        </div>
      )}
    </div>
  );
}
