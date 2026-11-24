"use client";

import Link from "next/link";
import { diasDeAtraso, type GrupoDeLaSemana } from "@/lib/mantenimiento/alertas";
import { fechaCorta } from "@/lib/mantenimiento/mtbfVista";

/**
 * Las órdenes que tenían que hacerse esta semana y no se hicieron.
 *
 * Es el recorte reciente del panel de atrasadas que va justo abajo, y por eso
 * se ve distinto: **ámbar acá y rojo allá**. Dos paneles rojos apilados son
 * ruido y dejan de distinguirse; lo de abajo es el atraso acumulado —hay una
 * orden de enero— y esto es lo que se pasó en los últimos siete días, que es
 * lo único sobre lo que todavía se puede hacer algo esta semana.
 *
 * **No se dibuja cuando da cero**, que es la misma regla que `OrdenesAtrasadas`:
 * un panel que dice «cero» todos los días enseña a no mirarlo, y el día que
 * diga otra cosa nadie lo va a ver.
 *
 * Y **no usa `.card`**, igual que el panel de abajo: esa clase declara su
 * propio `border` y su `box-shadow` fuera de toda capa, así que un
 * `border-amber-300` al lado no se aplicaría y el borde quedaría gris. Es la
 * trampa que CLAUDE.md deja anotada.
 */

/** Cuántas órdenes entran antes de mandar al listado. */
const CUANTAS_ENTRAN = 5;

export interface ResumenDeLaSemana {
  total: number;
  deTodas: number;
  desde: string;
  ordenes: any[];
  porEquipo: GrupoDeLaSemana[];
  porSector: GrupoDeLaSemana[];
}

/** Un agrupamiento: cada grupo enlaza a su listado cuando tiene id. */
function Agrupado({ titulo, grupos, parametro }: {
  titulo: string;
  grupos: GrupoDeLaSemana[];
  parametro: "equipo" | "sector";
}) {
  if (grupos.length === 0) return null;

  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">{titulo}</p>
      <ul className="mt-1 space-y-0.5">
        {grupos.map((g) => (
          <li key={g.clave} className="flex items-baseline gap-2 text-sm">
            <span className="w-5 shrink-0 text-right font-semibold tabular-nums text-amber-900">
              {g.cuantas}
            </span>
            {/* Sin id no hay a qué enlazar: la planilla trae el nombre en texto
                libre y el listado filtra por id. Se nombra igual, que es más
                que dejarlo afuera. */}
            {g.id ? (
              <Link
                href={`/mantenimiento/ordenes?${parametro}=${g.id}&atrasada=1`}
                className="min-w-0 flex-1 truncate text-amber-900 hover:underline"
                title={g.nombre}
              >
                {g.nombre}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate text-amber-900" title={g.nombre}>
                {g.nombre}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AtrasadasDeLaSemana({ resumen, hoy }: {
  resumen: ResumenDeLaSemana;
  hoy: string;
}) {
  if (resumen.total === 0) return null;

  const demas = resumen.ordenes.length - CUANTAS_ENTRAN;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-900">
          {resumen.total} de {resumen.deTodas} orden{resumen.deTodas === 1 ? "" : "es"} atrasada
          {resumen.deTodas === 1 ? "" : "s"} venía{resumen.total === 1 ? "" : "n"} entre el{" "}
          {fechaCorta(resumen.desde)} y el {fechaCorta(hoy)}
        </h2>
        <Link
          href="/mantenimiento/ordenes?atrasada=1"
          className="text-xs font-semibold text-amber-800 hover:underline"
        >
          Verlas todas →
        </Link>
      </div>

      <ul className="mt-3 space-y-1">
        {resumen.ordenes.slice(0, CUANTAS_ENTRAN).map((o: any) => {
          const dias = diasDeAtraso(o, hoy);
          return (
            <li key={o.ot_number} className="flex items-baseline gap-2 text-sm">
              <Link
                href={`/mantenimiento/ordenes?q=${o.ot_number}`}
                className="shrink-0 font-mono text-xs text-amber-500 hover:underline"
              >
                #{o.ot_number}
              </Link>
              <span className="min-w-0 flex-1 truncate text-amber-900">
                {o.descripcion ?? o.equipo_raw ?? "—"}
              </span>
              <span className="shrink-0 text-xs text-amber-700">
                {dias === null ? "sin fecha" : dias === 0 ? "vencía hoy" : `hace ${dias} día${dias === 1 ? "" : "s"}`}
              </span>
            </li>
          );
        })}
      </ul>
      {demas > 0 && (
        <p className="mt-1 text-xs text-amber-700">y {demas} más de esta semana</p>
      )}

      {/* Por equipo **y** por sector. El panel de abajo agrupa sólo por sector,
          que es a quién se le reclama; acá importa además el equipo, porque una
          máquina con dos órdenes vencidas en la misma semana está pidiendo algo
          y eso no se ve en el total del sector. */}
      <div className="mt-4 grid grid-cols-1 gap-4 border-t border-amber-200 pt-3 sm:grid-cols-2">
        <Agrupado titulo="Por equipo" grupos={resumen.porEquipo} parametro="equipo" />
        <Agrupado titulo="Por sector" grupos={resumen.porSector} parametro="sector" />
      </div>
    </div>
  );
}
