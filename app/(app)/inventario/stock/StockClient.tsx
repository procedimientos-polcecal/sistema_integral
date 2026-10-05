"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useArranqueDeLaUrl, useEspejoEnLaUrl } from "@/lib/core/usarLaUrl";
import {
  leerFiltrosDeStock, escribirFiltrosDeStock,
} from "@/lib/inventario/filtrosUrl";
import { altaDeReposicion, type AltaDeReposicion } from "@/lib/inventario/reponer";
import { useConfirm } from "@/components/ConfirmProvider";
import NuevoRequerimientoModal from "@/app/(app)/compras/requerimientos/NuevoRequerimientoModal";
import TraerDeLaPlanilla from "../TraerDeLaPlanilla";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

/** El RI en curso de un artículo, cuando la búsqueda lo pidió con `pedidos=1`. */
interface RiAbierto {
  id: string;
  nro_ri: number;
  diasDelRi: number;
  cuantosAbiertos: number;
}

interface Articulo {
  id: string;
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  stock_actual: number;
  stock_seguridad: number;
  faltante: number;
  stock_sincronizado_en: string | null;
  /** Sólo viene en los que tienen faltante; `null` es "no tiene pedido". */
  riAbierto?: RiAbierto | null;
}

type Opcion = { id: string; nombre: string };

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
  puedeOperar, sync, areas, empresas, ubicaciones,
}: {
  puedeOperar: boolean;
  sync: UltimaSync | null;
  /** Catálogos del alta de Compras. Los usa el modal de «Pedir». */
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
}) {
  const confirmar = useConfirm();
  const [pidiendo, setPidiendo] = useState<AltaDeReposicion | null>(null);
  const [pedido, setPedido] = useState("");
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
    // Que cada fila con faltante diga si ya tiene un pedido en curso. El otro
    // llamador de esta ruta —el buscador del formulario de movimiento— no lo
    // pide, y por eso no lo paga.
    params.set("pedidos", "1");

    const res = await fetch(`/api/inventario/articulos?${params}`);
    const body = await res.json().catch(() => ({}));
    setCargando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo buscar."); setArticulos([]); return; }
    // El stock se leyó, pero no se pudo saber qué tiene pedido. Se dice: sin
    // esto las filas se verían igual que si no hubiera ningún pedido abierto,
    // que es la lectura equivocada y la que hace pedir dos veces.
    if (body.errorPedidos) {
      setError(`El stock está bien, pero no se pudo saber qué tiene pedido: ${body.errorPedidos}`);
    }
    setArticulos(body.data ?? []);
  }, []);

  /**
   * Pedir un faltante.
   *
   * Si ya hay un RI abierto **no se bloquea, se avisa**: desde acá el caso
   * legítimo existe —el pedido viejo quedó trabado, o hace falta más cantidad—
   * y la persona eligió este artículo a propósito. Lo que no puede pasar es
   * pedir de nuevo sin enterarse, que es lo que hace hoy el Apps Script de la
   * planilla y por lo que seis códigos acumulan más de un RI abierto.
   *
   * En `/inventario/reponer` la regla es la otra —lo ya pedido va a un grupo
   * sin botón— y la diferencia es deliberada: esa lista propone, ésta no.
   */
  async function pedir(a: Articulo) {
    const ri = a.riAbierto;
    if (ri) {
      const cuantos = ri.cuantosAbiertos > 1 ? ` (y hay ${ri.cuantosAbiertos} abiertos en total)` : "";
      const cuando = ri.diasDelRi === 0 ? "hoy" : `hace ${ri.diasDelRi} día${ri.diasDelRi === 1 ? "" : "s"}`;
      const sigue = await confirmar({
        title: "Esto ya está pedido",
        message:
          `El RI ${ri.nro_ri} se pidió ${cuando} y sigue abierto${cuantos}. ` +
          `Si pedís de nuevo vas a crear un segundo pedido del mismo artículo.`,
        confirmText: "Pedir igual",
        cancelText: "No pedir",
      });
      if (!sigue) return;
    }
    setPidiendo(altaDeReposicion(a));
  }

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

      {/* Arriba y no en la fila: la lista se recarga al guardar y la fila que
          se pidió puede quedar fuera de la pantalla. */}
      {pedido && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {pedido} Lo vas a ver en{" "}
          <Link href="/mis-pedidos" className="underline">Mis pedidos</Link>.
        </p>
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
              <li key={a.id} className="card p-4">
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

                {/* `flex-wrap` y no una fila fija: a 375px, una descripción
                    larga con «Faltan 12», la línea del RI y los dos botones no
                    entran en un renglón. Con esto los botones bajan enteros en
                    vez de aplastar el texto de la izquierda. */}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {falta ? (
                      <span className="w-fit rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                        Faltan {a.faltante}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Por encima del mínimo</span>
                    )}
                    {/* Antes de tocar y no sólo al tocar: el cartel sorprende,
                        esta línea deja decidir. */}
                    {a.riAbierto && (
                      <span className="text-[11px] text-slate-500">
                        Ya pedido ·{" "}
                        <Link
                          href={`/compras/requerimientos/${a.riAbierto.id}`}
                          className="underline hover:text-slate-900"
                        >
                          RI {a.riAbierto.nro_ri}
                        </Link>
                        {a.riAbierto.diasDelRi === 0 ? ", hoy" : `, hace ${a.riAbierto.diasDelRi} días`}
                        {a.riAbierto.cuantosAbiertos > 1 && ` · ${a.riAbierto.cuantosAbiertos} abiertos`}
                      </span>
                    )}
                  </div>

                  {/* `ml-auto` para que los botones queden a la derecha también
                      cuando bajan de línea. Sin esto, la fila con pedido los
                      manda a la izquierda y la que no lo tiene los deja a la
                      derecha: bajando por la lista, los botones bailan. */}
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {/* Pedir no mira `puedeOperar`: cargar un movimiento es
                        operar el inventario, pedir un material lo puede hacer
                        cualquier usuario activo. Quien nota que algo se acabó
                        es el que está parado en el pañol. */}
                    {falta && (
                      <button
                        type="button"
                        onClick={() => pedir(a)}
                        className="min-h-9 rounded-lg border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)] hover:bg-[var(--primary-light)]"
                      >
                        Pedir
                      </button>
                    )}
                    {puedeOperar && (
                      <Link
                        href={`/inventario/movimientos/nuevo?articulo=${a.id}`}
                        className="flex min-h-9 items-center rounded-lg bg-[var(--primary)] px-3 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                      >
                        Movimiento
                      </Link>
                    )}
                  </div>
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

      {pidiendo && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          inicial={pidiendo}
          onClose={() => setPidiendo(null)}
          onSaved={() => {
            setPidiendo(null);
            setPedido("El pedido se cargó.");
            // La lista se vuelve a pedir para que la fila pase a decir «Ya
            // pedido»: si no, quedaría ofreciendo pedir lo que se acaba de
            // pedir, que es justo lo que este cambio vino a evitar.
            buscar(q.trim(), soloFaltantes);
          }}
        />
      )}
    </div>
  );
}
