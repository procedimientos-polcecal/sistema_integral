"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import InfoTip from "@/components/InfoTip";
import { useCargar } from "@/lib/core/useCargar";
import { PLAZO_DEL_SECTOR } from "@/lib/mantenimiento/porSector";
import { MINIMO_REPARACIONES } from "@/lib/mantenimiento/mttr";
import { duracionLegible } from "@/lib/mantenimiento/historialDeSectores";
import {
  DIAS_DE_CALENDARIO, HORAS_DE_TRABAJO, conComa, diasCorridos,
  porcentajeDeConfiabilidad,
} from "@/lib/mantenimiento/mtbfVista";
import type { IndicadoresDeLaPlantaPorSector, SectorConNombre } from "@/lib/mantenimiento/porSectorDatos";

const esqueleto = () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />;
const OrdenesPorMesYSector = dynamic(
  () => import("./GraficosMantenimiento").then((m) => m.OrdenesPorMesYSector),
  { ssr: false, loading: esqueleto }
);
const ConfiabilidadPorSector = dynamic(
  () => import("./GraficosMantenimiento").then((m) => m.ConfiabilidadPorSector),
  { ssr: false, loading: esqueleto }
);

/**
 * Los tres bloques del tablero que salen de `/api/mantenimiento/indicadores-por-sector`.
 *
 * **Se pide una sola vez, desde el cliente y después del primer pintado**, y
 * el estado baja a los tres: tres pedidos de lo mismo serían tres lecturas de
 * 2.500 filas para dibujar lo mismo. El patrón —esqueleto, «no se pudo» con
 * reintento, y el recuadro ocupando su lugar siempre— es el de `PeoresPorMtbf`
 * y está ahí el porqué medido: esconder el bloque hace saltar el tablero
 * cuando llega la respuesta, y «falló la lectura» se vuelve indistinguible de
 * «no hay nada que mostrar».
 *
 * **Los tres respetan el filtro de empresa y sector**, y lo hacen en el
 * navegador sobre lo ya traído: cambiar de empresa no vuelve a pedir nada.
 */

/** `null` mientras carga, `"error"` si el pedido falló. */
export type Estado = IndicadoresDeLaPlantaPorSector | "error" | null;

/** Los dos filtros del tablero, tal como los tiene: por **nombre**. */
export interface Filtro {
  empresa: string;
  sector: string;
}

/**
 * Cuántas líneas entran en el gráfico de confiabilidad sin filtro.
 *
 * Seis es el límite de lo que se distingue por color, y nunca choca con el
 * filtro: ninguna empresa tiene más de seis sectores de planta (POLCECAL 6,
 * TRANSVERSAL 5, POLYSAN 4), así que elegir una empresa muestra los suyos
 * enteros.
 */
const CUANTAS_LINEAS = 6;

/** La misma paleta categórica que usa el gráfico de criticidad del tablero. */
const COLORES = ["#1E7D34", "#E8A020", "#2563EB", "#DC2626", "#7E22CE", "#0891B2", "#B45309", "#0F766E"];

const PLANT_COLORS: Record<string, string> = {
  POLYSAN: "var(--accent)", POLCECAL: "var(--primary)", TRANSVERSAL: "var(--status-mant)",
};

export function useIndicadoresPorSector(): { datos: Estado; recargar: () => void } {
  const [datos, setDatos] = useState<Estado>(null);

  const recargar = useCargar(async (vigente) => {
    try {
      const r = await fetch("/api/mantenimiento/indicadores-por-sector");
      if (!r.ok) throw new Error("No se pudieron traer los indicadores por sector");
      const datos: IndicadoresDeLaPlantaPorSector = await r.json();
      if (!vigente()) return;
      setDatos(datos);
    } catch {
      if (vigente()) setDatos("error");
    }
  }, []);

  return { datos, recargar };
}

/** Las filas que deja el filtro, en el orden en que vinieron (peor primero). */
function filasDelFiltro(datos: IndicadoresDeLaPlantaPorSector, filtro: Filtro): SectorConNombre[] {
  return datos.filas.filter((f) => {
    if (filtro.sector !== "TODOS") return f.sector === filtro.sector;
    if (filtro.empresa !== "TODAS") return f.empresa === filtro.empresa;
    return true;
  });
}

/** El recuadro común: título, tooltip y los tres estados de la carga. */
function Recuadro({
  titulo, ayuda, datos, recargar, alto, children,
}: {
  titulo: string;
  ayuda: string;
  datos: Estado;
  recargar?: () => void;
  /** Alto del esqueleto, para que el tablero no salte cuando llegue. */
  alto: string;
  children: (datos: IndicadoresDeLaPlantaPorSector) => React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">{titulo}</h2>
        <InfoTip text={ayuda} />
      </div>

      {datos === null ? (
        <div className={`${alto} animate-pulse rounded-lg bg-slate-100`} aria-busy="true" aria-label={`Cargando ${titulo}`} />
      ) : datos === "error" ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-sm text-slate-600">
            No se pudo calcular.{" "}
            <span className="text-slate-500">Esto no quiere decir que los sectores estén bien.</span>
          </p>
          {recargar && (
            <button
              type="button"
              onClick={recargar}
              className="text-sm font-medium text-[var(--primary)] hover:underline"
            >
              Reintentar
            </button>
          )}
        </div>
      ) : (
        children(datos)
      )}
    </div>
  );
}

// ── INDICADORES: la tabla de fiabilidad ─────────────────────────────────────

const AYUDA_FIABILIDAD = [
  "Cada cuánto falla algo en el sector, cuánto lleva arreglarlo y qué tan probable es que aguante una semana sin una correctiva.",
  "Se cuenta sobre las correctivas del último año, desde la primera falla de cada sector.",
  DIAS_DE_CALENDARIO.titulo,
  "El MTBF es del sector entero y no de una máquina: Filler 1 tiene una correctiva cada dos días porque tiene muchas máquinas, no porque alguna falle cada dos días.",
].join(" ");

/**
 * MTBF, MTTR, MTTF y confiabilidad de cada sector.
 *
 * **No hay fila de total, y no es un olvido.** Las 981 correctivas del último
 * año dan un MTBF de planta de 0,36 días y una confiabilidad de 0,00 %: es
 * aritméticamente correcto y no dice nada, porque una planta con quince
 * sectores tiene una correctiva cada nueve horas por construcción.
 */
export function FiabilidadPorSector({ datos, filtro, recargar }: {
  datos: Estado;
  filtro: Filtro;
  recargar: () => void;
}) {
  return (
    <Recuadro titulo="Fiabilidad por sector" ayuda={AYUDA_FIABILIDAD} datos={datos} recargar={recargar} alto="h-56">
      {(d) => {
        const filas = filasDelFiltro(d, filtro);
        if (filas.length === 0) {
          return (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              Ningún sector del filtro tuvo correctivas en el último año.
            </p>
          );
        }

        return (
          <>
            {/* La tabla no entra en los 343 px de un teléfono: va con scroll
                propio, que es la regla de la casa. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Sector</th>
                    <th className="py-2 px-2 text-right font-semibold">Fallas</th>
                    <th className="py-2 px-2 text-right font-semibold">
                      MTBF <span className="normal-case text-slate-300">cada cuánto falla</span>
                    </th>
                    <th className="py-2 px-2 text-right font-semibold">
                      MTTR <span className="normal-case text-slate-300">cuánto lleva</span>
                    </th>
                    <th className="py-2 px-2 text-right font-semibold">MTTF</th>
                    <th className="py-2 pl-2 text-right font-semibold">Aguanta {PLAZO_DEL_SECTOR} días</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filas.map((f) => (
                    <tr key={f.sectorId} className="hover:bg-slate-50">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/mantenimiento/ordenes?sector=${f.sectorId}`}
                          className="text-slate-900 hover:underline"
                        >
                          {f.sector}
                        </Link>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-500">{f.fallas}</td>
                      <td
                        className="py-2 px-2 text-right font-semibold tabular-nums"
                        style={{ color: f.mtbf === null ? "var(--text-muted)" : "var(--status-rep)" }}
                      >
                        {diasCorridos(f.mtbf)}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-700">
                        {f.mttr === null ? "—" : `${conComa(f.mttr, 1)} h`}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-700">
                        {diasCorridos(f.mttf)}
                      </td>
                      <td className="py-2 pl-2 text-right tabular-nums text-slate-900">
                        {porcentajeDeConfiabilidad(f.confiabilidad)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Los tres avisos van en texto visible y no en el tooltip: cada
                uno tapa una forma de leer mal el número de al lado. */}
            <ul className="mt-3 space-y-1 text-xs text-amber-800">
              <li>{DIAS_DE_CALENDARIO.corto}</li>
              <li>{HORAS_DE_TRABAJO.titulo}</li>
              <li>
                <span className="font-semibold">El MTTF es derivado, no medido:</span>{" "}
                es el MTBF menos el MTTR, así que queda a unas horas del MTBF —el MTTR
                son horas de trabajo y no de parada—.
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-400">
              Sin MTTR cuando el sector no llega a {MINIMO_REPARACIONES} reparaciones propias
              con horas cargadas; sin MTBF cuando se observó muy poco. La confiabilidad supone
              una tasa de falla constante: es una aproximación declarada, no una medición.
              {d.sinSector > 0 && ` ${d.sinSector} correctiva${d.sinSector === 1 ? "" : "s"} del año no tiene sector y no entra${d.sinSector === 1 ? "" : "n"}.`}
            </p>
          </>
        );
      }}
    </Recuadro>
  );
}

// ── EVOLUCIÓN MENSUAL: los dos gráficos ─────────────────────────────────────

/** Qué series se dibujan y de qué color, según el filtro. */
function seriesDelFiltro(
  d: IndicadoresDeLaPlantaPorSector,
  filtro: Filtro,
  porEmpresaSinFiltro: boolean
): { claves: string[]; colores: Record<string, string>; porEmpresa: boolean } {
  if (filtro.sector !== "TODOS") {
    return { claves: [filtro.sector], colores: { [filtro.sector]: COLORES[0] }, porEmpresa: false };
  }

  if (filtro.empresa !== "TODAS") {
    const claves = d.sectores.filter((s) => s.empresa === filtro.empresa).map((s) => s.nombre);
    const colores: Record<string, string> = {};
    claves.forEach((c, i) => { colores[c] = COLORES[i % COLORES.length]; });
    return { claves, colores, porEmpresa: false };
  }

  if (porEmpresaSinFiltro) {
    const claves = [...new Set(d.sectores.map((s) => s.empresa))];
    return { claves, colores: PLANT_COLORS, porEmpresa: true };
  }

  // La confiabilidad no se puede sumar por empresa, así que sin filtro se
  // dibujan los sectores que más fallaron. `filas` ya viene con el que menos
  // aguanta arriba.
  const claves = d.filas.slice(0, CUANTAS_LINEAS).map((f) => f.sector);
  const colores: Record<string, string> = {};
  claves.forEach((c, i) => { colores[c] = COLORES[i % COLORES.length]; });
  return { claves, colores, porEmpresa: false };
}

const AYUDA_EVOLUCION =
  "Cuántas órdenes se generaron cada mes y cómo viene la confiabilidad de cada sector. " +
  "Las órdenes se cuentan por la fecha en que se cargaron, igual que el gráfico de abajo. " +
  `La confiabilidad es la probabilidad de aguantar ${PLAZO_DEL_SECTOR} días sin una correctiva, ` +
  "y cada punto se calcula con los 90 días anteriores: con las fallas de un mes solo el número " +
  "salta y baja sin que haya cambiado nada en la planta.";

export function EvolucionPorSector({ datos, filtro }: { datos: Estado; filtro: Filtro }) {
  return (
    <Recuadro titulo="Órdenes y confiabilidad por sector" ayuda={AYUDA_EVOLUCION} datos={datos} alto="h-96">
      {(d) => {
        const deOrdenes = seriesDelFiltro(d, filtro, true);
        const deConfiabilidad = seriesDelFiltro(d, filtro, false);

        const nombrePorId = new Map(d.sectores.map((s) => [s.id, s]));

        const datosDeOrdenes = d.ordenesPorMes.map((mes) => {
          const fila: Record<string, unknown> = { etiqueta: mes.etiqueta };
          for (const clave of deOrdenes.claves) fila[clave] = 0;
          for (const [sectorId, cuantas] of Object.entries(mes.porSector)) {
            const sector = nombrePorId.get(sectorId);
            if (!sector) continue;
            const clave = deOrdenes.porEmpresa ? sector.empresa : sector.nombre;
            if (!(clave in fila)) continue;
            fila[clave] = (fila[clave] as number) + cuantas;
          }
          return fila;
        });

        const porNombre = new Map(d.filas.map((f) => [f.sector, f]));
        const datosDeConfiabilidad = (d.filas[0]?.porMes ?? []).map((_, i) => {
          const fila: Record<string, unknown> = { etiqueta: d.filas[0].porMes[i].etiqueta };
          for (const clave of deConfiabilidad.claves) {
            // Un sector sin ninguna falla en el año no tiene serie: su línea
            // no existe, que es distinto de tener un hueco.
            fila[clave] = porNombre.get(clave)?.porMes[i].confiabilidad ?? null;
          }
          return fila;
        });

        return (
          <div className="space-y-6">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-400">
                Órdenes generadas por mes{deOrdenes.porEmpresa ? ", por empresa" : ", por sector"}
              </p>
              <OrdenesPorMesYSector
                datos={datosDeOrdenes}
                claves={deOrdenes.claves}
                colores={deOrdenes.colores}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-400">
                Probabilidad de aguantar {PLAZO_DEL_SECTOR} días sin una correctiva
                {filtro.sector === "TODOS" && filtro.empresa === "TODAS" &&
                  ` — los ${Math.min(CUANTAS_LINEAS, d.filas.length)} sectores que más fallan`}
              </p>
              {datosDeConfiabilidad.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  Todavía no hay correctivas con las que calcularla.
                </p>
              ) : (
                <ConfiabilidadPorSector
                  datos={datosDeConfiabilidad}
                  claves={deConfiabilidad.claves}
                  colores={deConfiabilidad.colores}
                  mesEnCurso={d.mesEnCurso}
                />
              )}
              <p className="mt-2 text-xs text-amber-800">
                El último punto está incompleto y <span className="font-semibold">tiende a verse mejor
                de lo que es</span>: su ventana termina hoy y las correctivas se cargan desde la
                planilla con retraso. Un mes sin línea es un mes que no se pudo medir, no uno sin
                fallas.
              </p>
            </div>
          </div>
        );
      }}
    </Recuadro>
  );
}

// ── EVOLUCIÓN MENSUAL: las paradas ──────────────────────────────────────────

const AYUDA_PARADAS =
  "Cuántas veces se paró cada sector y cuánto tiempo estuvo sin producir, desde que el " +
  "sistema lo registra. Suma las paradas y las reparaciones juntas: desde producción las " +
  "dos son lo mismo. Un sector parado ahora suma el tiempo que lleva.";

/** `2026-11-12T13:26:27Z` como `12/11/2026`. */
function diaCorto(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ParadasDeSector({ datos, filtro }: { datos: Estado; filtro: Filtro }) {
  return (
    <Recuadro titulo="Paradas de mantenimiento por sector" ayuda={AYUDA_PARADAS} datos={datos} alto="h-32">
      {(d) => {
        const deLaEmpresa = new Set(
          d.sectores
            .filter((s) => filtro.empresa === "TODAS" || s.empresa === filtro.empresa)
            .filter((s) => filtro.sector === "TODOS" || s.nombre === filtro.sector)
            .map((s) => s.id)
        );
        // Una fila huérfana —sector borrado— no está en el catálogo y no se
        // puede filtrar por empresa: entra sólo cuando no hay filtro puesto.
        const sinFiltro = filtro.empresa === "TODAS" && filtro.sector === "TODOS";
        const paradas = d.paradas.sectores.filter((s) =>
          s.sectorId === null ? sinFiltro : deLaEmpresa.has(s.sectorId)
        );

        return (
          <>
            {paradas.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                Ningún sector del filtro cambió de estado todavía.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {paradas.map((s) => (
                  <li key={s.sectorId ?? s.sector} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{s.sector}</span>
                    {s.paradoDesde && (
                      <span
                        className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase"
                        style={{ color: "var(--status-rep)", borderColor: "#FECACA", background: "#FEF2F2" }}
                      >
                        parado ahora
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-slate-500">
                      {s.veces === 0
                        ? "sin paradas"
                        : `${s.veces} parada${s.veces === 1 ? "" : "s"} · ${duracionLegible(s.fueraDeServicioMs)} sin producir`}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              {/* Este renglón es la mitad del bloque: con tres cambios en la
                  tabla, una lista corta sin él se lee como «la planta casi no
                  para». La fecha sale de la base, así que el día que haya un
                  año de historia deja de llamar la atención solo. */}
              <p className="text-xs text-slate-500">
                {d.paradas.desde
                  ? `El sistema registra los cambios de estado desde el ${diaCorto(d.paradas.desde)}: lo anterior a esa fecha no está.`
                  : "Todavía no se registró ningún cambio de estado de sector."}
              </p>
              <Link
                href="/mantenimiento/sectores/historial"
                className="text-xs font-semibold text-[var(--primary)] hover:underline"
              >
                Ver el historial completo →
              </Link>
            </div>
          </>
        );
      }}
    </Recuadro>
  );
}
