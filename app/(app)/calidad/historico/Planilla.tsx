"use client";

import { useMemo } from "react";
import { comoSeLee } from "@/lib/core/fechas";
import type { FilaDeLaBusqueda } from "@/lib/calidad/historico/aplanar";

/**
 * El resultado a lo ancho, como Calidad lo leyó durante tres años.
 *
 * **Pivotea por `(fecha, fila_excel)` y no sólo por fecha.** Hay 29 fechas
 * repetidas en `Cal` y 4 en `Filler 2` que son muestras distintas del mismo
 * día; colapsarlas por fecha haría desaparecer una, y nadie se enteraría.
 *
 * Y arma **una tabla por hoja**: dos hojas con juegos de mallas distintos en una
 * sola tabla son columnas vacías que no significan nada.
 */
export default function Planilla({ filas }: { filas: FilaDeLaBusqueda[] }) {
  const porHoja = useMemo(() => {
    const hojas = new Map<string, FilaDeLaBusqueda[]>();
    for (const f of filas) hojas.set(f.origen, [...(hojas.get(f.origen) ?? []), f]);

    return [...hojas].map(([hoja, suyas]) => {
      // Las columnas, en el orden en que aparecen: es el de la planilla.
      const columnas: string[] = [];
      for (const f of suyas) if (!columnas.includes(f.determinacion)) columnas.push(f.determinacion);

      const renglones = new Map<string, Map<string, FilaDeLaBusqueda>>();
      for (const f of suyas) {
        const clave = `${f.fecha}|${f.fila_excel ?? ""}`;
        const r = renglones.get(clave) ?? new Map();
        r.set(f.determinacion, f);
        renglones.set(clave, r);
      }

      const ordenados = [...renglones].sort((a, b) => b[0].localeCompare(a[0]));
      return { hoja, columnas, renglones: ordenados };
    });
  }, [filas]);

  if (porHoja.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
        El resultado no tiene filas de las hojas tabulares.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {porHoja.map(({ hoja, columnas, renglones }) => (
        <div key={hoja} className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">{hoja}</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  {columnas.map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 text-right">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renglones.map(([clave, celdas]) => {
                  const fecha = clave.split("|")[0];
                  const marcada = [...celdas.values()].some((f) => f.revisar);
                  return (
                    <tr key={clave} className={`border-t border-slate-100 ${marcada ? "bg-amber-50" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{comoSeLee(fecha)}</td>
                      {columnas.map((c) => {
                        const f = celdas.get(c);
                        return (
                          <td key={c} className="px-3 py-2 text-right tabular-nums">
                            {f ? f.valor : <span className="text-slate-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {/* En esta vista los números van pelados, así que la escala se dice una
          vez por tabla en vez de en cada celda. */}
      {/* La nota decía «los anteriores al 02/06/2026», y era falsa: las 251
          humedades posteriores al corte también son fracción. En esta vista los
          números van pelados, así que la nota es toda la defensa que hay. */}
      <p className="text-xs text-slate-500">
        Acá los valores van pelados. Hay dos escalas conviviendo: los retenidos y
        acumulados anteriores al 02/06/2026 están escritos como fracción —un 0,19 quiere
        decir 19%—, y <strong>la humedad es fracción siempre</strong>, también después de
        esa fecha. La lista de arriba lo aclara valor por valor.
      </p>
    </div>
  );
}
