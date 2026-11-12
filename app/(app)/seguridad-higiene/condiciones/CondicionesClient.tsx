"use client";

import { useEffect, useMemo, useState } from "react";
import Select from "@/components/Select";
import { comoSeLee } from "@/lib/core/fechas";
import { clasificar, type Clasificacion } from "@/lib/seguridadHigiene/riesgo";
import { estadoDe, type Estado, type Falta } from "@/lib/seguridadHigiene/condicion";
import {
  faltasPendientes,
  filtrarCondiciones,
  NOMBRE_DE_CLASIFICACION,
  NOMBRE_DE_FALTA,
  ordenarParaGestion,
  resumenDeCondiciones,
  SIN_FILTROS,
  type FiltrosDeGestion,
  type FilaDeCondicion,
} from "@/lib/seguridadHigiene/gestion";
import { escribirFiltrosDeGestion, escribirOrdenDeGestion } from "@/lib/seguridadHigiene/filtrosUrl";
import {
  ORDEN_POR_DEFECTO,
  SIN_COLUMNA,
  ordenarPorColumna,
  siguienteOrden,
  type ColumnaOrdenable,
  type OrdenDeColumna,
} from "@/lib/seguridadHigiene/ordenDeColumna";
import FichaDeCondicion, { type Catalogos } from "./FichaDeCondicion";
import { InsigniaDeClasificacion, InsigniaDeEstado, InsigniaDeFalta } from "./Insignias";
import NuevaCondicionModal from "./NuevaCondicionModal";

/**
 * La tabla de condiciones inseguras.
 *
 * **Lo que falta se ve antes que lo que está completo.** Es el anti-objetivo
 * del módulo, y tiene un porqué medido: la planilla de la que sale tenía 44
 * condiciones y 35 sin evaluar, porque nada las mostraba. Por defecto la tabla
 * ordena las vencidas primero, después las que les falta algo y después el
 * resto por nivel de riesgo (`ordenarParaGestion`), y arriba de todo el
 * encabezado dice cuántas son de cada una, con un botón para ir directo.
 */

/**
 * El borde de alerta de las tarjetas del resumen, **por `style` y no por una
 * clase**.
 *
 * `.card` declara `border` en `app/globals.css` **fuera de toda capa**, y las
 * utilidades de Tailwind v4 viven en `@layer utilities`: entre una regla sin
 * capa y una con capa gana siempre la que no tiene capa, pase lo que pase con
 * la especificidad. O sea que `border-red-300` al lado de `card` **no se
 * aplica nunca** —es la misma trampa que `className="input w-20"`, por el lado
 * del borde en vez del ancho—. Un `style` sí gana, y es lo que ya hacen los
 * badges de Mantenimiento.
 *
 * Son los hex de `red-300` y `amber-300` de Tailwind, escritos acá porque un
 * `style` no puede nombrar una clase.
 */
const BORDE_VENCIDAS = "#FCA5A5";
const BORDE_SIN_COMPLETAR = "#FCD34D";

function lugarDe(c: FilaDeCondicion): string {
  if (c.sectores?.nombre) return c.sectores.nombre;
  if (c.equipos) return `${c.equipos.code ? `${c.equipos.code} · ` : ""}${c.equipos.name}`;
  return "";
}

/** Riesgo de una fila: la sigla con el nivel, o un guión si no está evaluada. */
function Riesgo({ c }: { c: FilaDeCondicion }) {
  const clase = clasificar(c.nivel_riesgo);
  if (c.nivel_riesgo === null || !clase) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <InsigniaDeClasificacion clasificacion={clase} />
      <span className="tabular-nums text-slate-600">{c.nivel_riesgo}</span>
    </span>
  );
}

/** El estado y, si sigue abierta, lo que le falta. En una cerrada no se pide nada. */
function Marcas({ c, hoy }: { c: FilaDeCondicion; hoy: string }) {
  const estado = estadoDe(c, hoy);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <InsigniaDeEstado estado={estado} />
      {faltasPendientes(c, hoy).map((f) => <InsigniaDeFalta key={f} falta={f} />)}
    </span>
  );
}

/**
 * Un encabezado que ordena al tocarlo.
 *
 * Calcado del de MTBF (`mantenimiento/mtbf/MtbfClient.tsx`), que es la otra
 * tabla del sistema que ordena por columna. `aria-sort` va en el `th` y el
 * botón adentro: así un lector de pantalla dice por cuál está ordenada sin
 * que la flecha sea la única señal.
 */
function Encabezado({
  columna, orden, onOrdenar, children,
}: {
  columna: ColumnaOrdenable;
  orden: OrdenDeColumna;
  onOrdenar: (c: ColumnaOrdenable) => void;
  children: React.ReactNode;
}) {
  const activa = orden.columna === columna;
  return (
    <th
      className="px-3 py-2"
      aria-sort={activa ? (orden.ascendente ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => onOrdenar(columna)} className="hover:text-slate-900">
        {children}
        <span className="ml-1 text-xs text-slate-400">{activa ? (orden.ascendente ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

export default function CondicionesClient({
  filtrosIniciales,
  condicionesIniciales,
  sectores,
  equipos,
  peligros,
  usuarios,
  hoy,
  puedeEditar,
  esAdmin,
  ordenInicial,
  condicionInicial = null,
}: Catalogos & {
  filtrosIniciales: FiltrosDeGestion;
  ordenInicial: OrdenDeColumna;
  condicionesIniciales: FilaDeCondicion[];
  hoy: string;
  puedeEditar: boolean;
  esAdmin: boolean;
  /**
   * El `?condicion=<id>` de la URL: la ficha que se abre al cargar. Es adonde
   * lleva el correo de una mención, y llega como texto sin validar —quién dice
   * si existe es la lista de acá abajo, que ya las tiene todas—.
   */
  condicionInicial?: string | null;
}) {
  const [filas, setFilas] = useState(condicionesIniciales);
  const [filtros, setFiltros] = useState<FiltrosDeGestion>(filtrosIniciales);
  const [orden, setOrden] = useState<OrdenDeColumna>(ordenInicial);
  // Arranca en el `?condicion=` del enlace. Llegar aquí con la ficha abierta y
  // no con la lista es lo que hace que el correo de una mención sirva: la
  // pantalla no tiene buscador y las condiciones se ordenan por número
  // descendente, así que «buscá la N° 7» era pedirle a alguien que recorriera
  // 44 filas. Que el parámetro desaparezca de la barra lo hace solo el efecto
  // de abajo, que reescribe la URL desde los filtros: recargar entonces no
  // vuelve a abrir una ficha que ya se cerró, igual que en Mis pedidos.
  const [abierta, setAbierta] = useState<string | null>(condicionInicial);
  /** Si está abierto el alta. */
  const [cargando, setCargando] = useState(false);

  const sectorDeEquipo = useMemo(
    () => new Map(equipos.map((e) => [e.id, e.sector_id] as const)),
    [equipos]
  );

  // La URL va detrás de los filtros, como en las OT de Mantenimiento: con
  // `history` y no `router.replace`, que le pediría la página entera al servidor
  // —todas las condiciones y los cuatro catálogos— para cambiar un query string
  // que la pantalla ya tiene resuelto en memoria. Con `replace` y no `push`:
  // salir con el botón de atrás no obliga a deshacer cada filtro.
  const query = [escribirFiltrosDeGestion(filtros), escribirOrdenDeGestion(orden)]
    .filter(Boolean)
    .join("&");
  useEffect(() => {
    const destino = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    if (destino === window.location.pathname + window.location.search) return;
    // El estado que va es el que ya estaba: ahí guarda Next su árbol de rutas.
    window.history.replaceState(window.history.state, "", destino);
  }, [query]);

  const nombreDeUsuario = useMemo(
    () => new Map(usuarios.map((u) => [u.id, u.nombre] as const)),
    [usuarios]
  );

  const resumen = useMemo(() => resumenDeCondiciones(filas, hoy), [filas, hoy]);

  // El orden por defecto es el de la pantalla, no el de una columna: sube lo
  // vencido y lo incompleto, que es el anti-objetivo del módulo. Tocar un
  // encabezado lo reemplaza **mientras dure**, y por eso hay un botón para
  // volver: si ordenar por N° dejara sin salida, la tabla perdería la única
  // garantía que tiene que dar.
  const visibles = useMemo(() => {
    const filtradas = filtrarCondiciones(filas, filtros, hoy, sectorDeEquipo);
    return orden.columna === SIN_COLUMNA
      ? ordenarParaGestion(filtradas, hoy)
      : ordenarPorColumna(filtradas, orden, hoy, nombreDeUsuario);
  }, [filas, filtros, orden, hoy, sectorDeEquipo, nombreDeUsuario]);

  // Del filtro de lugar sólo se ofrece donde hay algo: 273 equipos con tres
  // condiciones cargadas serían 270 opciones que dan una tabla vacía.
  const lugares = useMemo(() => {
    const sectoresConAlgo = new Set<string>();
    const equiposConAlgo = new Set<string>();
    for (const c of filas) {
      if (c.sector_id) sectoresConAlgo.add(c.sector_id);
      if (c.equipo_id) {
        equiposConAlgo.add(c.equipo_id);
        const delEquipo = sectorDeEquipo.get(c.equipo_id);
        if (delEquipo) sectoresConAlgo.add(delEquipo);
      }
    }
    return {
      sectores: sectores.filter((s) => sectoresConAlgo.has(s.id)),
      equipos: equipos.filter((e) => equiposConAlgo.has(e.id)),
    };
  }, [filas, sectores, equipos, sectorDeEquipo]);


  const hayFiltros = Object.values(filtros).some((v) => v !== "");
  const hayOtroOrden = orden.columna !== SIN_COLUMNA;

  function cambiarOrden(columna: ColumnaOrdenable) {
    setOrden((o) => siguienteOrden(o, columna));
  }
  const fichaAbierta = abierta ? (filas.find((c) => c.id === abierta) ?? null) : null;

  // El enlace de un correo puede traer un id que ya no está —la condición se
  // borró— o uno mal escrito. Sin esto, la pantalla mostraba la lista como si
  // el enlace no hubiera dicho nada, y quien venía de un aviso se quedaba
  // buscando. No distingue las dos causas, y es a propósito: desde acá se ven
  // iguales, y afirmar cuál fue sería inventar.
  const elEnlaceNoLlego =
    condicionInicial !== null && !filas.some((c) => c.id === condicionInicial);

  function poner<K extends keyof FiltrosDeGestion>(campo: K, valor: FiltrosDeGestion[K]) {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  }

  /**
   * Vuelve a leer la lista después de un alta.
   *
   * No alcanza con `router.refresh()`: las filas viven en un `useState` que se
   * inicializa una sola vez con lo que trajo el servidor, así que un
   * re-render del Server Component no las toca. Y no se recarga la página
   * entera porque esto se usa cargando una tanda, y perder la posición de la
   * tabla en cada alta es exactamente lo que haría que se deje de usar.
   */
  async function volverALeer() {
    setCargando(false);
    try {
      const res = await fetch("/api/seguridad-higiene/condiciones");
      if (!res.ok) return;
      const { data } = await res.json();
      if (Array.isArray(data)) setFilas(data as FilaDeCondicion[]);
    } catch {
      // La condición ya entró; que la tabla tarde un refresco en mostrarla no
      // vale un cartel de error sobre un alta que salió bien.
    }
  }

  function guardada(fila: FilaDeCondicion) {
    setFilas((todas) => todas.map((c) => (c.id === fila.id ? fila : c)));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      {/* El alta va acá arriba y no escondida al final de la tabla: hasta el
          02/11/2026 **no existía en ninguna pantalla** —el único camino era
          `/cargar`, cuyo link vive en el menú de Mantenimiento—, así que quien
          tenía este módulo y no aquél no tenía forma de cargar nada. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-xl font-bold text-slate-900">Condiciones inseguras</h1>
        <p className="text-sm text-slate-500">
          {visibles.length} de {filas.length} condiciones.
          {resumen.cerradas > 0 && ` ${resumen.cerradas} cerradas.`}
        </p>
        </div>
        {puedeEditar && (
          <button type="button" className="btn-primary shrink-0" onClick={() => setCargando(true)}>
            + Nueva condición
          </button>
        )}
      </div>

      {elEnlaceNoLlego && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          El enlace llevaba a una condición insegura que no está en la lista: puede que la hayan
          borrado, o que el enlace esté mal. Lo que se habló sigue en su hilo.
        </p>
      )}

      {/* Lo que hay para hacer, antes que nada. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFiltros({ ...SIN_FILTROS, estado: "Vencida" })}
          className="card px-3 py-2 text-left text-sm"
          style={resumen.vencidas > 0 ? { borderColor: BORDE_VENCIDAS } : undefined}
        >
          <span className={`text-lg font-bold ${resumen.vencidas > 0 ? "text-red-700" : "text-slate-900"}`}>
            {resumen.vencidas}
          </span>{" "}
          {resumen.vencidas === 1 ? "vencida" : "vencidas"}
        </button>
        <button
          type="button"
          onClick={() => setFiltros({ ...SIN_FILTROS, falta: "alguna", estado: "abierta" })}
          className="card px-3 py-2 text-left text-sm"
          style={resumen.sinCompletar > 0 ? { borderColor: BORDE_SIN_COMPLETAR } : undefined}
        >
          <span className={`text-lg font-bold ${resumen.sinCompletar > 0 ? "text-amber-700" : "text-slate-900"}`}>
            {resumen.sinCompletar}
          </span>{" "}
          sin completar
        </button>
        <button
          type="button"
          onClick={() => setFiltros({ ...SIN_FILTROS, estado: "abierta" })}
          className="card px-3 py-2 text-left text-sm"
        >
          <span className="text-lg font-bold text-slate-900">{resumen.abiertas}</span> abiertas
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          className="input"
          value={filtros.estado}
          onChange={(e) => poner("estado", e.target.value as Estado | "abierta" | "")}
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          <option value="abierta">Abiertas (pendientes y vencidas)</option>
          <option value="Pendiente">Pendientes</option>
          <option value="Vencida">Vencidas</option>
          <option value="Cerrada">Cerradas</option>
        </Select>

        <Select
          className="input"
          value={filtros.falta}
          onChange={(e) => poner("falta", e.target.value as Falta | "alguna" | "")}
          aria-label="Lo que falta"
        >
          <option value="">Esté completa o no</option>
          <option value="alguna">Les falta algo</option>
          <option value="sin_evaluar">{NOMBRE_DE_FALTA.sin_evaluar}</option>
          <option value="sin_asignar">{NOMBRE_DE_FALTA.sin_asignar}</option>
          <option value="sin_lugar">{NOMBRE_DE_FALTA.sin_lugar}</option>
        </Select>

        <Select
          className="input"
          value={filtros.lugar}
          onChange={(e) => poner("lugar", e.target.value)}
          aria-label="Sector o equipo"
        >
          <option value="">Todos los sectores y equipos</option>
          {lugares.sectores.map((s) => (
            <option key={`s:${s.id}`} value={`s:${s.id}`}>
              Sector · {s.nombre}
            </option>
          ))}
          {lugares.equipos.map((e) => (
            <option key={`e:${e.id}`} value={`e:${e.id}`}>
              Equipo · {e.nombre}
            </option>
          ))}
        </Select>

        <Select
          className="input"
          value={filtros.clasificacion}
          onChange={(e) => poner("clasificacion", e.target.value as Clasificacion | "sin_clasificar" | "")}
          aria-label="Clasificación del riesgo"
        >
          <option value="">Todas las clasificaciones</option>
          {(Object.keys(NOMBRE_DE_CLASIFICACION) as Clasificacion[]).map((k) => (
            <option key={k} value={k}>
              {k} · {NOMBRE_DE_CLASIFICACION[k]}
            </option>
          ))}
          <option value="sin_clasificar">Sin evaluar</option>
        </Select>
      </div>

      {/* El botón va sin `text-sm`: `.btn-ghost` también declara `font-size`
          fuera de toda capa, así que siempre midió 13 px. Ver CLAUDE.md. */}
      {(hayFiltros || hayOtroOrden) && (
        <div className="flex flex-wrap items-center gap-3">
          {hayFiltros && (
            <button type="button" className="btn-ghost" onClick={() => setFiltros(SIN_FILTROS)}>
              Quitar los filtros
            </button>
          )}
          {/* El camino de vuelta al orden que sube lo que falta. Sin esto,
              ordenar por una columna sería una puerta de ida. */}
          {hayOtroOrden && (
            <button type="button" className="btn-ghost" onClick={() => setOrden(ORDEN_POR_DEFECTO)}>
              Volver al orden sugerido
            </button>
          )}
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
          {filas.length === 0
            ? "Todavía no hay condiciones cargadas."
            : "Ninguna condición coincide con los filtros."}
        </p>
      ) : (
        <>
          {/* Tabla en pantalla ancha. */}
          <div className="hidden overflow-x-auto rounded border border-slate-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <Encabezado columna="numero" orden={orden} onOrdenar={cambiarOrden}>N°</Encabezado>
                  <Encabezado columna="estado" orden={orden} onOrdenar={cambiarOrden}>Estado</Encabezado>
                  <Encabezado columna="lugar" orden={orden} onOrdenar={cambiarOrden}>Lugar</Encabezado>
                  <Encabezado columna="descripcion" orden={orden} onOrdenar={cambiarOrden}>Qué se vio</Encabezado>
                  <Encabezado columna="peligro" orden={orden} onOrdenar={cambiarOrden}>Peligro</Encabezado>
                  <Encabezado columna="riesgo" orden={orden} onOrdenar={cambiarOrden}>Riesgo</Encabezado>
                  <Encabezado columna="responsable" orden={orden} onOrdenar={cambiarOrden}>Responsable</Encabezado>
                  <Encabezado columna="fecha_maxima" orden={orden} onOrdenar={cambiarOrden}>Fecha máxima</Encabezado>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibles.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer align-top hover:bg-slate-50"
                    onClick={() => setAbierta(c.id)}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-semibold text-slate-900 underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAbierta(c.id);
                        }}
                      >
                        {c.numero}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <Marcas c={c} hoy={hoy} />
                    </td>
                    <td className="px-3 py-2">
                      {lugarDe(c) || <span className="text-amber-700">Sin lugar</span>}
                    </td>
                    <td className="max-w-64 px-3 py-2 text-slate-700">
                      <span className="line-clamp-2" title={c.descripcion}>
                        {c.descripcion}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{c.syh_peligros?.nombre ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Riesgo c={c} />
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {c.responsable_id ? (nombreDeUsuario.get(c.responsable_id) ?? "—") : "—"}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 ${
                        estadoDe(c, hoy) === "Vencida" ? "font-semibold text-red-700" : "text-slate-600"
                      }`}
                    >
                      {c.fecha_maxima ? comoSeLee(c.fecha_maxima) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en el teléfono: la tabla no entra y recortarla miente. */}
          <ul className="space-y-2 md:hidden">
            {visibles.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setAbierta(c.id)}
                  className="block w-full space-y-1.5 rounded border border-slate-200 bg-white p-3 text-left"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">N° {c.numero}</span>
                    <Riesgo c={c} />
                  </span>
                  <Marcas c={c} hoy={hoy} />
                  <span className="line-clamp-2 block text-sm text-slate-700">{c.descripcion}</span>
                  <span className="block text-xs text-slate-500">
                    {lugarDe(c) || "Sin lugar"}
                    {c.syh_peligros ? ` · ${c.syh_peligros.nombre}` : ""}
                  </span>
                  {c.fecha_maxima && (
                    <span
                      className={`block text-xs ${
                        estadoDe(c, hoy) === "Vencida" ? "font-semibold text-red-700" : "text-slate-500"
                      }`}
                    >
                      Fecha máxima: {comoSeLee(c.fecha_maxima)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {cargando && (

        <NuevaCondicionModal

          sectores={sectores}

          equipos={equipos}

          peligros={peligros}

          onCerrar={() => setCargando(false)}

          onCargada={volverALeer}

        />

      )}


      {fichaAbierta && (
        <FichaDeCondicion
          // Una ficha por condición: al abrir otra, el borrador y las fotos arrancan limpios.
          key={fichaAbierta.id}
          fila={fichaAbierta}
          catalogos={{ sectores, equipos, peligros, usuarios }}
          hoy={hoy}
          puedeEditar={puedeEditar}
          esAdmin={esAdmin}
          onGuardada={guardada}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </div>
  );
}
