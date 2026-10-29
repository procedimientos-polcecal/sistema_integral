"use client";

import { useMemo, useState } from "react";
import Select from "@/components/Select";
import { comoSeLee } from "@/lib/core/fechas";
import { clasificar, type Clasificacion } from "@/lib/seguridadHigiene/riesgo";
import { estadoDe, loQueFalta, type Estado, type Falta } from "@/lib/seguridadHigiene/condicion";
import {
  filtrarCondiciones,
  NOMBRE_DE_CLASIFICACION,
  NOMBRE_DE_FALTA,
  ordenarParaGestion,
  resumenDeCondiciones,
  SIN_FILTROS,
  type FiltrosDeGestion,
  type FilaDeCondicion,
} from "@/lib/seguridadHigiene/gestion";
import FichaDeCondicion, { type Catalogos } from "./FichaDeCondicion";
import { InsigniaDeClasificacion, InsigniaDeEstado, InsigniaDeFalta } from "./Insignias";

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
      {estado !== "Cerrada" && loQueFalta(c).map((f) => <InsigniaDeFalta key={f} falta={f} />)}
    </span>
  );
}

export default function CondicionesClient({
  condicionesIniciales,
  sectores,
  equipos,
  peligros,
  usuarios,
  hoy,
  puedeEditar,
  esAdmin,
}: Catalogos & {
  condicionesIniciales: FilaDeCondicion[];
  hoy: string;
  puedeEditar: boolean;
  esAdmin: boolean;
}) {
  const [filas, setFilas] = useState(condicionesIniciales);
  const [filtros, setFiltros] = useState<FiltrosDeGestion>(SIN_FILTROS);
  const [abierta, setAbierta] = useState<string | null>(null);

  const sectorDeEquipo = useMemo(
    () => new Map(equipos.map((e) => [e.id, e.sector_id] as const)),
    [equipos]
  );

  const resumen = useMemo(() => resumenDeCondiciones(filas, hoy), [filas, hoy]);

  const visibles = useMemo(
    () => ordenarParaGestion(filtrarCondiciones(filas, filtros, hoy, sectorDeEquipo), hoy),
    [filas, filtros, hoy, sectorDeEquipo]
  );

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

  const nombreDeUsuario = useMemo(
    () => new Map(usuarios.map((u) => [u.id, u.nombre] as const)),
    [usuarios]
  );

  const hayFiltros = Object.values(filtros).some((v) => v !== "");
  const fichaAbierta = abierta ? (filas.find((c) => c.id === abierta) ?? null) : null;

  function poner<K extends keyof FiltrosDeGestion>(campo: K, valor: FiltrosDeGestion[K]) {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  }

  function guardada(fila: FilaDeCondicion) {
    setFilas((todas) => todas.map((c) => (c.id === fila.id ? fila : c)));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Condiciones inseguras</h1>
        <p className="text-sm text-slate-500">
          {visibles.length} de {filas.length} condiciones.
          {resumen.cerradas > 0 && ` ${resumen.cerradas} cerradas.`}
        </p>
      </div>

      {/* Lo que hay para hacer, antes que nada. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFiltros({ ...SIN_FILTROS, estado: "Vencida" })}
          className={`card px-3 py-2 text-left text-sm ${resumen.vencidas > 0 ? "border-red-300" : ""}`}
        >
          <span className={`text-lg font-bold ${resumen.vencidas > 0 ? "text-red-700" : "text-slate-900"}`}>
            {resumen.vencidas}
          </span>{" "}
          {resumen.vencidas === 1 ? "vencida" : "vencidas"}
        </button>
        <button
          type="button"
          onClick={() => setFiltros({ ...SIN_FILTROS, falta: "alguna", estado: "Pendiente" })}
          className={`card px-3 py-2 text-left text-sm ${resumen.sinCompletar > 0 ? "border-amber-300" : ""}`}
        >
          <span className={`text-lg font-bold ${resumen.sinCompletar > 0 ? "text-amber-700" : "text-slate-900"}`}>
            {resumen.sinCompletar}
          </span>{" "}
          sin completar
        </button>
        <button
          type="button"
          onClick={() => setFiltros(SIN_FILTROS)}
          className="card px-3 py-2 text-left text-sm"
        >
          <span className="text-lg font-bold text-slate-900">{resumen.abiertas}</span> abiertas
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          className="input"
          value={filtros.estado}
          onChange={(e) => poner("estado", e.target.value as Estado | "")}
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
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

      {hayFiltros && (
        <button type="button" className="btn-ghost text-sm" onClick={() => setFiltros(SIN_FILTROS)}>
          Quitar los filtros
        </button>
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
                  <th className="px-3 py-2">N°</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Lugar</th>
                  <th className="px-3 py-2">Qué se vio</th>
                  <th className="px-3 py-2">Peligro</th>
                  <th className="px-3 py-2">Riesgo</th>
                  <th className="px-3 py-2">Responsable</th>
                  <th className="px-3 py-2">Fecha máxima</th>
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
