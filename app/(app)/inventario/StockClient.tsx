"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
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
  const [q, setQ] = useState("");
  const [soloFaltantes, setSoloFaltantes] = useState(false);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [sincronizando, setSincronizando] = useState(false);
  const [avisoSync, setAvisoSync] = useState<string | null>(null);

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

  async function sincronizar() {
    setSincronizando(true);
    setAvisoSync(null);
    const res = await fetch("/api/inventario/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);

    if (!res.ok) { setAvisoSync(body.error ?? "No se pudo sincronizar."); return; }

    const sinReconocer = Object.entries(body.sin_reconocer ?? {})
      .map(([catalogo, nombres]) => `${(nombres as string[]).length} ${catalogo}`)
      .join(", ");

    setAvisoSync(
      `${body.articulos} artículos y ${body.movimientos} movimientos.` +
      (body.movimientos_sin_articulo > 0
        ? ` ${body.movimientos_sin_articulo} movimientos son de un código que no está en el listado.`
        : "") +
      (sinReconocer ? ` Sin reconocer contra el sistema: ${sinReconocer}.` : "")
    );
    buscar(q.trim(), soloFaltantes);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stock</h1>
          <p className="text-sm text-slate-500">
            Lo que hay en el pañol, según la última lectura de la planilla.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <UltimaSincronizacion cuando={sync?.created_at} ok={sync?.ok ?? true} error={sync?.error} />
          <button
            onClick={sincronizar}
            disabled={sincronizando}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {sincronizando ? "Trayendo…" : "Traer de la planilla"}
          </button>
        </div>
      </div>

      {avisoSync && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {avisoSync}
        </div>
      )}
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
