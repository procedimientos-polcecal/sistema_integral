"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useArranqueDeLaUrl, useEspejoEnLaUrl } from "@/lib/core/usarLaUrl";
import {
  leerFiltrosDeStock, escribirFiltrosDeStock,
} from "@/lib/inventario/filtrosUrl";
import TraerDeLaPlanilla from "./TraerDeLaPlanilla";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

interface Articulo {
  id: string;
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  stock_actual: number;
  stock_seguridad: number;
  faltante: number;
  stock_sincronizado_en: string | null;
}

/**
 * El stock del pañol.
 *
 * Es la pantalla que se abre en el celular parado frente al estante, así que la
 * búsqueda va arriba y grande, y cada artículo se lee de un vistazo: cuánto hay,
 * cuánto debería haber, y si falta.
 *
 * **No sincroniza sola al abrirse.** La pantalla del repo de origen sí lo hacía,
 * y allá era barato: pedía sólo el stock a un webhook. Acá la sincronización lee
 * las dos pestañas y escribe unas 6.900 filas — hacer eso cada vez que alguien
 * mira si hay guantes sería lento y caro. Va con botón y con reloj, y la
 * pantalla dice de cuándo es el número.
 */
export default function StockClient({
  puedeOperar, sync,
}: {
  puedeOperar: boolean;
  sync: UltimaSync | null;
}) {
  // La búsqueda y el filtro de faltantes arrancan de la URL y vuelven a ella:
  // desde acá se sale a cargar un movimiento, y al volver la lista tiene que
  // estar como estaba. De paso, "los faltantes de rodamientos" se puede mandar
  // por chat como un enlace en vez de explicarse.
  const arranque = useArranqueDeLaUrl(leerFiltrosDeStock);
  const [q, setQ] = useState(arranque.busqueda);
  const [soloFaltantes, setSoloFaltantes] = useState(arranque.soloFaltantes);
  useEspejoEnLaUrl(escribirFiltrosDeStock({ busqueda: q, soloFaltantes }));
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const buscar = useCallback(async (termino: string, faltantes: boolean) => {
    setCargando(true);
    setError("");
    const params = new URLSearchParams();
    if (termino) params.set("q", termino);
    if (faltantes) params.set("faltantes", "1");

    const res = await fetch(`/api/inventario/articulos?${params}`);
    const body = await res.json().catch(() => ({}));
    setCargando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo buscar."); setArticulos([]); return; }
    setArticulos(body.data ?? []);
  }, []);

  // Espera un momento para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => buscar(q.trim(), soloFaltantes), 300);
    return () => clearTimeout(t);
  }, [q, soloFaltantes, buscar]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Stock</h1>
        <p className="text-sm text-slate-500">
          Lo que hay en el pañol, según la última lectura de la planilla.
        </p>
      </div>

      {/* Después de traer, la lista se vuelve a pedir: el stock que muestra es
          justamente lo que la sincronización acaba de cambiar. */}
      <TraerDeLaPlanilla sync={sync} onListo={() => buscar(q.trim(), soloFaltantes)} />
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Grande y arriba: se usa con una mano, parado. */}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        inputMode="search"
        placeholder="Buscar por código o descripción…"
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
        autoFocus
      />

      <label className="flex w-fit items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={soloFaltantes}
          onChange={(e) => setSoloFaltantes(e.target.checked)}
        />
        Sólo lo que falta
      </label>

      {cargando ? (
        <p className="py-10 text-center text-sm text-slate-400">Buscando…</p>
      ) : articulos.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          {q || soloFaltantes
            ? "Ningún artículo coincide."
            : "Todavía no hay artículos. Traelos de la planilla."}
        </p>
      ) : (
        <ul className="space-y-2">
          {articulos.map((a) => {
            const falta = a.faltante > 0;
            return (
              <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{a.descripcion}</p>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono">{a.codigo}</span>
                      {a.ubicacion ? ` · ${a.ubicacion}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-lg font-semibold ${falta ? "text-red-600" : "text-slate-900"}`}>
                      {a.stock_actual}
                    </p>
                    <p className="text-[11px] text-slate-400">seguridad {a.stock_seguridad}</p>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  {falta ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                      Faltan {a.faltante}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">Por encima del mínimo</span>
                  )}
                  {puedeOperar && (
                    <Link
                      href={`/inventario/movimientos/nuevo?articulo=${a.id}`}
                      className="rounded-lg bg-[var(--primary)] px-3 py-1 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                    >
                      Movimiento
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-slate-400">
        La planilla del almacén es la que manda: el stock sale de sus fórmulas y
        acá se lee. Lo que se carga desde el sistema se escribe allá en el
        momento.
      </p>
    </div>
  );
}
