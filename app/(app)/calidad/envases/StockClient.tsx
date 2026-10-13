"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import TraerDeLaPlanilla from "./TraerDeLaPlanilla";
import { faltantesPorGrupo } from "@/lib/calidad/envases/seguridad";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

export interface ArticuloEnPantalla {
  id: string;
  codigo: string;
  descripcion: string;
  grupo: string | null;
  /** El bloque combinado del listado al que pertenece. Un suelto es grupo de uno. */
  grupo_seguridad: string | null;
  stock_actual: number;
  stock_seguridad: number;
}

/**
 * El stock de envases.
 *
 * **El mínimo y el faltante son del grupo, no del artículo**, y la tabla lo
 * muestra como la planilla: una celda que abarca las filas del bloque. En el
 * listado esas celdas están combinadas porque lo que importa es cuántos
 * bolsones de 1,20 hay en total, sin importar de qué proveedor sea cada uno.
 * Antes esta pantalla comparaba el mínimo contra el stock de cada fila, así que
 * decía que al primer artículo del grupo le faltaba todo y a los demás nada.
 *
 * El número de stock **es lo que dijo la planilla**, no un cálculo del SdG: la
 * columna de stock allá es una fórmula sobre el kardex. Por eso la fecha de la
 * última lectura va arriba — un número sin fecha se lee como si fuera de ahora.
 */
export default function StockClient({
  articulos, puedeOperar, sync,
}: {
  articulos: ArticuloEnPantalla[];
  puedeOperar: boolean;
  sync: UltimaSync | null;
}) {
  const [q, setQ] = useState("");
  const [soloFaltantes, setSoloFaltantes] = useState(false);

  const grupos = useMemo(() => {
    const faltantes = faltantesPorGrupo(articulos);

    const miembros = new Map<string, ArticuloEnPantalla[]>();
    for (const a of articulos) {
      const g = a.grupo_seguridad ?? a.codigo;
      const lista = miembros.get(g) ?? [];
      lista.push(a);
      miembros.set(g, lista);
    }

    const termino = q.trim().toLowerCase();
    const coincide = (a: ArticuloEnPantalla) =>
      !termino ||
      a.codigo.toLowerCase().includes(termino) ||
      a.descripcion.toLowerCase().includes(termino) ||
      (a.grupo ?? "").toLowerCase().includes(termino);

    return [...miembros]
      .map(([g, lista]) => ({
        resumen: faltantes.get(g)!,
        // La búsqueda filtra artículos, no grupos: si se busca "torraco"
        // aparece esa fila, y al lado el faltante del grupo entero, que es el
        // número contra el que se decide comprar.
        lista: lista.filter(coincide).sort((a, b) => a.codigo.localeCompare(b.codigo)),
      }))
      .filter((g) => g.lista.length > 0)
      .filter((g) => !soloFaltantes || g.resumen.faltante > 0)
      // Por faltante: lo que hay que comprar primero va arriba. Con el código
      // como desempate, para que la tabla no baile entre dos corridas iguales.
      .sort(
        (a, b) =>
          b.resumen.faltante - a.resumen.faltante ||
          a.resumen.grupo.localeCompare(b.resumen.grupo)
      );
  }, [articulos, q, soloFaltantes]);

  const hayAlgo = grupos.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stock de envases</h1>
          <p className="text-sm text-slate-500">
            Lo que hay, según la última lectura de la planilla.
          </p>
        </div>
        {puedeOperar && (
          <Link
            href="/calidad/envases/movimientos"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Cargar movimiento
          </Link>
        )}
      </div>

      <TraerDeLaPlanilla sync={sync} />

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por código, descripción o grupo"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloFaltantes}
            onChange={(e) => setSoloFaltantes(e.target.checked)}
          />
          Sólo faltantes
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Seguridad</th>
              <th className="px-3 py-2 text-right">Falta</th>
            </tr>
          </thead>
          {grupos.map(({ resumen, lista }) => (
            // Un `<tbody>` por grupo: separa los bloques a la vista sin pintar
            // nada, y es donde el `rowSpan` de las dos últimas columnas tiene
            // sentido — hacen lo mismo que la celda combinada de la planilla.
            <tbody key={resumen.grupo} className="border-t-2 border-slate-200">
              {lista.map((a, i) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{a.codigo}</td>
                  <td className="px-3 py-2 text-slate-900">{a.descripcion}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.stock_actual}</td>
                  {i === 0 && (
                    <>
                      <td
                        rowSpan={lista.length}
                        className="border-l border-slate-100 px-3 py-2 text-right align-middle tabular-nums text-slate-500"
                      >
                        {resumen.stock_seguridad || "—"}
                        {resumen.articulos > 1 && (
                          <span className="block text-xs font-normal text-slate-400">
                            suman {resumen.stock}
                          </span>
                        )}
                      </td>
                      <td
                        rowSpan={lista.length}
                        className={`px-3 py-2 text-right align-middle tabular-nums ${
                          resumen.faltante > 0
                            ? "font-semibold text-red-600"
                            : "text-slate-400"
                        }`}
                      >
                        {resumen.faltante > 0 ? resumen.faltante : "—"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          ))}
          {!hayAlgo && (
            <tbody>
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  {articulos.length === 0
                    ? "Todavía no se trajo nada de la planilla."
                    : "Ningún artículo coincide."}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      {/* Lo que la tabla no puede decir sola, y que es la pregunta que va a
          llegar la primera vez que alguien compare con la planilla. */}
      <p className="text-sm text-slate-500">
        El mínimo y el faltante son <strong>del grupo</strong>: los bolsones se
        cuentan todos juntos, sin importar el proveedor, igual que en las celdas
        combinadas de la planilla.
      </p>
    </div>
  );
}
