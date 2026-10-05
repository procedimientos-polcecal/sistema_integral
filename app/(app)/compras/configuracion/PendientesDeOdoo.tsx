"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { useRouter } from "next/navigation";
import { fecha as comoFecha, monedaExacta } from "@/lib/compras/constants";
import type { ResumenDePendientes } from "@/lib/compras/pendientesDeOdoo";

/**
 * Mandar a Odoo los pedidos que quedaron sin su orden.
 *
 * ## De dónde sale la pila
 *
 * El disparador de la orden vivía en la ruta de la app y el estado llega a
 * PEDIDO por la sincronización, así que durante semanas no se creó ninguna. Eso
 * ya está arreglado, pero mira transiciones: no toca el pasado. Esto es el
 * pasado.
 *
 * ## Por qué hay tanto antes del botón
 *
 * Porque el botón escribe **ciento setenta y siete órdenes en la contabilidad
 * real del grupo**, por más de cien millones de pesos. Lo que se muestra —
 * cuántas órdenes (no cuántos pedidos), cuánta plata, desde qué fecha, y una
 * muestra de cuáles— es lo que permite decidir en vez de apretar a ciegas.
 *
 * El corte por fecha no es un filtro de conveniencia: la orden se crea con
 * `date_order` de **hoy**, así que mandar un pedido de 2025 le pone fecha de
 * hoy en Odoo. Quien manda decide desde cuándo.
 */

interface Muestra {
  nro_ri: number;
  fecha: string | null;
  descripcion: string | null;
  costo_iva: number | null;
  paga_ambas: boolean;
}

interface Avance {
  /** Pedidos resueltos. */
  pedidos: number;
  /**
   * Órdenes creadas en Odoo, que no es lo mismo: un pedido AMBAS son dos. Todo
   * el panel insiste en esa diferencia, así que el resultado no puede contar
   * una cosa y nombrar la otra.
   */
  ordenes: number;
  fallaron: { nro_ri: number; motivo: string }[];
  quedan: number;
}

export default function PendientesDeOdoo({ esAdmin }: { esAdmin: boolean }) {
  const router = useRouter();
  const [desde, setDesde] = useState("");
  const [resumen, setResumen] = useState<ResumenDePendientes | null>(null);
  const [muestra, setMuestra] = useState<Muestra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mandando, setMandando] = useState(false);
  const [avance, setAvance] = useState<Avance | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `useCargar` y no un efecto que llama y listo: descarta la respuesta que
  // llega tarde. Ver `lib/core/useCargar.ts`.
  const mirar = useCargar(async (vigente) => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/compras/odoo/pendientes${desde ? `?desde=${desde}` : ""}`
      );
      const body = await res.json().catch(() => ({}));
      if (!vigente()) return;
      if (!res.ok) {
        setError(body.error ?? "No se pudo leer la cola.");
        return;
      }
      setResumen(body.resumen);
      setMuestra(body.muestra ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, [desde]);

  /**
   * Manda tanda tras tanda hasta que no quede nada **o hasta que una tanda no
   * cree ninguna**.
   *
   * Ese segundo corte es el que importa: los que fallan siguen en la cola —no
   * tienen vínculo— y sin él la pantalla pediría tandas para siempre sobre los
   * mismos cinco. Cada uno que falla queda con su motivo en la ficha.
   */
  async function mandar() {
    if (!resumen) return;
    const seguro = window.confirm(
      `Se van a crear ${resumen.ordenes} órdenes de compra en Odoo, por ` +
        `${monedaExacta(resumen.total)}. Es la contabilidad real del grupo. ¿Seguimos?`
    );
    if (!seguro) return;

    setMandando(true);
    setError(null);
    let pedidos = 0;
    let ordenes = 0;
    const fallaron: Avance["fallaron"] = [];

    try {
      for (;;) {
        const res = await fetch("/api/compras/odoo/pendientes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(desde ? { desde } : {}),
        });
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(body.error ?? "No se pudo mandar la cola.");
          break;
        }

        for (const c of body.creadas ?? []) {
          pedidos += 1;
          ordenes += (c.ordenes ?? []).length;
        }
        for (const f of body.fallaron ?? []) {
          if (!fallaron.some((x) => x.nro_ri === f.nro_ri)) fallaron.push(f);
        }
        setAvance({ pedidos, ordenes, fallaron: [...fallaron], quedan: body.quedan ?? 0 });

        if (!body.quedan || !body.avanzo) break;
      }
    } finally {
      setMandando(false);
      mirar();
      router.refresh();
    }
  }

  const hay = (resumen?.requerimientos ?? 0) > 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Pedidos sin su orden en Odoo
      </h2>

      <p className="mb-3 text-sm text-slate-600">
        Quedaron de cuando la orden se creaba sólo al mover el estado desde el sistema, y el
        estado llega por la planilla. Eso ya está arreglado para los nuevos; éstos son los de
        antes.
      </p>

      {cargando ? (
        <p className="text-sm text-slate-400">Mirando la cola…</p>
      ) : !hay ? (
        <p className="text-sm text-slate-500">
          No hay pedidos esperando su orden{desde && " desde esa fecha"}.
        </p>
      ) : (
        <>
          {/*
            Las órdenes, y no los pedidos, es el número que importa: un pedido
            que pagan las dos empresas son dos órdenes, una en cada
            contabilidad. Mostrar sólo "119 pedidos" escondería 58.
          */}
          <div className="mb-3 grid gap-3 sm:grid-cols-3">
            <Dato valor={String(resumen!.ordenes)} que="órdenes en Odoo" />
            <Dato valor={String(resumen!.requerimientos)} que="pedidos" />
            <Dato valor={monedaExacta(resumen!.total)} que="en total" />
          </div>

          {resumen!.masViejo && (
            <p className="mb-3 text-xs text-slate-500">
              Van del {comoFecha(resumen!.masViejo)} al {comoFecha(resumen!.masNuevo)}.{" "}
              <strong>La orden se crea con fecha de hoy</strong>, no con la del pedido.
            </p>
          )}

          <label className="mb-3 block text-xs font-medium text-slate-600">
            Mandar sólo los de esta fecha en adelante
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              disabled={mandando}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:opacity-50"
            />
          </label>

          {muestra.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {muestra.map((m) => (
                <li key={m.nro_ri} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="font-mono">RI {m.nro_ri}</span> · {comoFecha(m.fecha)} ·{" "}
                    {m.descripcion ?? "—"}
                    {m.paga_ambas && " · AMBAS"}
                  </span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">
                    {monedaExacta(m.costo_iva)}
                  </span>
                </li>
              ))}
              {resumen!.requerimientos > muestra.length && (
                <li className="pt-1 opacity-70">
                  …y {resumen!.requerimientos - muestra.length} más.
                </li>
              )}
            </ul>
          )}

          {esAdmin ? (
            <button
              onClick={mandar}
              disabled={mandando}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
            >
              {mandando
                ? `Mandando… ${avance?.ordenes ?? 0} órdenes creadas, quedan ${avance?.quedan ?? "…"} pedidos`
                : `Crear las ${resumen!.ordenes} órdenes en Odoo`}
            </button>
          ) : (
            <p className="text-xs text-slate-500">
              Mandar la cola entera es de admin de Compras. Cada pedido se puede mandar de a uno
              desde su ficha.
            </p>
          )}
        </>
      )}

      {avance && !mandando && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Se crearon <strong>{avance.ordenes}</strong> órdenes en Odoo, de {avance.pedidos}{" "}
          pedido(s).
          {avance.quedan > 0 && ` Quedan ${avance.quedan} pedidos sin mandar.`}
          {avance.fallaron.length > 0 && (
            <>
              <p className="mt-1 font-medium">No se pudo con {avance.fallaron.length}:</p>
              <ul className="mt-0.5 space-y-0.5">
                {avance.fallaron.slice(0, 5).map((f) => (
                  <li key={f.nro_ri}>
                    RI {f.nro_ri}: {f.motivo}
                  </li>
                ))}
              </ul>
              {/*
                El motivo ya quedó guardado en el requerimiento, así que esto no
                es la única copia: desde la ficha se ve y se reintenta.
              */}
              <p className="mt-1 opacity-80">
                Cada uno quedó con su motivo anotado en la ficha, con el botón para reintentar.
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

function Dato({ valor, que }: { valor: string; que: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-lg font-bold text-slate-900">{valor}</div>
      <div className="text-xs text-slate-500">{que}</div>
    </div>
  );
}
