"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NuevoRequerimientoModal from "@/app/(app)/compras/requerimientos/NuevoRequerimientoModal";
import {
  APROBACION_LABELS, COMPRA_LABELS, etiquetaPrioridad, fecha,
} from "@/lib/compras/constants";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

type Opcion = { id: string; nombre: string };

const POR_PAGINA = 50;

/**
 * Mis pedidos, y los de todos.
 *
 * Fuera del módulo Compras a propósito: cualquier usuario puede pedir un
 * material y seguir su pedido aunque no trabaje en Compras.
 *
 * **Y puede ver los de los demás.** No es un agregado suelto: es para lo que
 * sirve la pestaña "Requerimientos Internos" de la planilla, donde caen los RI
 * de todas las áreas. Sin eso, dos personas piden el mismo rodamiento la misma
 * semana y nadie se entera hasta que llegan dos. Buscar antes de pedir es la
 * mitad del valor de esta pantalla.
 *
 * Lo que **no** se muestra son los costos ni las comparativas: para saber si
 * algo ya se pidió alcanza con qué es, quién lo pidió y en qué anda. El detalle
 * comercial sigue dentro del módulo Compras, que es de quien es la decisión.
 *
 * La lista se arma en el cliente y no en el servidor: son 1.947 requerimientos
 * y mandarlos todos al navegador para mostrar cincuenta es lo que hace que una
 * pantalla tarde tres segundos en abrir.
 */
export default function MisPedidosClient({
  usuarioId, areas, empresas, ubicaciones,
}: {
  usuarioId: string;
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
}) {
  const router = useRouter();
  const [modalAbierto, setModalAbierto] = useState(false);

  /** "mios" arranca puesto: la pantalla se llama Mis pedidos. */
  const [alcance, setAlcance] = useState<"mios" | "todos">("mios");
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [pagina, setPagina] = useState(0);

  const [pedidos, setPedidos] = useState<RequerimientoConRelaciones[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // La búsqueda espera un momento para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => { setPagina(0); }, [alcance, busquedaAplicada]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    const supabase = createClient();

    let q = supabase
      .from("compras_requerimientos")
      // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
      .select(
        "*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores(nombre)",
        { count: "exact" }
      );

    if (alcance === "mios") q = q.eq("solicitante_id", usuarioId);

    if (busquedaAplicada) {
      // Un número suelto se busca como N° de RI, que es como lo pide la gente.
      const comoNumero = Number(busquedaAplicada);
      if (Number.isInteger(comoNumero) && comoNumero > 0) {
        q = q.eq("nro_ri", comoNumero);
      } else {
        const p = `%${busquedaAplicada.replace(/[%,()]/g, " ")}%`;
        q = q.or(`descripcion.ilike.${p},codigo.ilike.${p},solicitante_nombre.ilike.${p}`);
      }
    }

    const desde = pagina * POR_PAGINA;
    const { data, count, error: err } = await q
      .order("nro_ri", { ascending: false })
      .range(desde, desde + POR_PAGINA - 1);

    setCargando(false);
    if (err) { setError(err.message); setPedidos([]); return; }
    setPedidos((data ?? []) as RequerimientoConRelaciones[]);
    setTotal(count ?? 0);
  }, [alcance, busquedaAplicada, pagina, usuarioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const paginas = Math.ceil(total / POR_PAGINA);
  const esMio = (p: RequerimientoConRelaciones) => p.solicitante_id === usuarioId;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {alcance === "mios" ? "Mis pedidos" : "Todos los pedidos"}
          </h1>
          <p className="text-sm text-slate-500">
            {alcance === "mios"
              ? "Lo que pediste y en qué anda."
              : "Todos los requerimientos, de todas las áreas. Buscá acá antes de pedir."}
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          + Pedir un material
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-300">
          {(["mios", "todos"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setAlcance(v)}
              className={`px-3 py-1.5 text-sm font-medium ${
                alcance === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v === "mios" ? "Míos" : "Todos"}
            </button>
          ))}
        </div>

        {/* El buscador es la herramienta de "esto ya lo pidió alguien": busca
            por descripción, por código, por quién lo pidió, y un número suelto
            lo toma como N° de RI. */}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por descripción, código, N° de RI…"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:max-w-sm"
        />

        {!cargando && (
          <span className="text-xs text-slate-400">
            {total.toLocaleString("es-AR")} {total === 1 ? "pedido" : "pedidos"}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-400">Cargando…</p>
      ) : pedidos.length === 0 ? (
        <Vacio
          alcance={alcance}
          buscando={Boolean(busquedaAplicada)}
          onVerTodos={() => setAlcance("todos")}
          onPedir={() => setModalAbierto(true)}
        />
      ) : (
        <>
        {/* En un teléfono, tarjetas. Ocho columnas no entran, y acá la pregunta
            es una sola —¿en qué anda este pedido?—, así que los dos estados van
            arriba y grandes en vez de perdidos en la sexta y séptima columna. */}
        <div className="space-y-2 md:hidden">
          {pedidos.map((p) => (
            <article key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs font-semibold text-slate-500">RI {p.nro_ri}</span>
                {alcance === "todos" && esMio(p) && (
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">Mío</span>
                )}
                <Chip {...APROBACION_LABELS[p.estado_aprobacion]} />
                <Chip {...COMPRA_LABELS[p.estado_compra]} />
              </div>

              <p className="text-sm leading-snug text-slate-900">{p.descripcion}</p>

              {p.motivo_rechazo && (
                <p className="mt-1 text-xs text-red-600">Rechazado: {p.motivo_rechazo}</p>
              )}
              {p.estado_compra === "RECIBIDO" && p.fecha_recepcion && (
                <p className="mt-1 text-xs text-green-700">Recibido el {fecha(p.fecha_recepcion)}</p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span>Pedido el {fecha(p.fecha)}</span>
                {p.cantidad && <span>· {p.cantidad} u.</span>}
                {p.compras_areas?.nombre && <span>· {p.compras_areas.nombre}</span>}
                <Solicitante pedido={p} mostrar={alcance === "todos"} />
                <Chip {...etiquetaPrioridad(p.prioridad)} />
              </div>
            </article>
          ))}
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">N° RI</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Qué se pidió</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-left">Área</th>
                  {alcance === "todos" && <th className="px-3 py-2 text-left">Quién pidió</th>}
                  <th className="px-3 py-2 text-left">Prioridad</th>
                  <th className="px-3 py-2 text-left">Aprobación</th>
                  <th className="px-3 py-2 text-left">Compra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pedidos.map((p) => (
                  <tr key={p.id} className={esMio(p) ? "bg-slate-50/70" : "hover:bg-slate-50"}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-500">
                      {p.nro_ri}
                      {alcance === "todos" && esMio(p) && (
                        <span className="ml-1.5 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          Mío
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(p.fecha)}</td>
                    <td className="max-w-sm px-3 py-2 text-slate-900">
                      {p.descripcion}
                      {p.motivo_rechazo && (
                        <div className="text-xs text-red-600">Rechazado: {p.motivo_rechazo}</div>
                      )}
                      {p.estado_compra === "RECIBIDO" && p.fecha_recepcion && (
                        <div className="text-xs text-green-700">Recibido el {fecha(p.fecha_recepcion)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{p.cantidad ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{p.compras_areas?.nombre ?? "—"}</td>
                    {alcance === "todos" && (
                      <td className="px-3 py-2 text-slate-600">
                        {p.solicitante_nombre ?? <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    <td className="px-3 py-2"><Chip {...etiquetaPrioridad(p.prioridad)} /></td>
                    <td className="px-3 py-2"><Chip {...APROBACION_LABELS[p.estado_aprobacion]} /></td>
                    <td className="px-3 py-2"><Chip {...COMPRA_LABELS[p.estado_compra]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {paginas > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-slate-600">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="py-1">{pagina + 1} de {paginas}</span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
              disabled={pagina >= paginas - 1}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
        </>
      )}

      {modalAbierto && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          onClose={() => setModalAbierto(false)}
          onSaved={() => { setModalAbierto(false); cargar(); router.refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * Quién lo pidió.
 *
 * Los 1.947 requerimientos que vinieron de la planilla **no traen solicitante**:
 * la columna "SOLICITA" que el importador busca no existe con ese nombre en la
 * hoja, o está vacía. Se dice "no figura" en vez de dejar el lugar en blanco,
 * porque un blanco se lee como "nadie lo pidió" y no como "la planilla no lo
 * dice".
 */
function Solicitante({
  pedido, mostrar,
}: {
  pedido: RequerimientoConRelaciones;
  mostrar: boolean;
}) {
  if (!mostrar) return null;
  return (
    <span>· {pedido.solicitante_nombre ?? "sin solicitante"}</span>
  );
}

function Vacio({
  alcance, buscando, onVerTodos, onPedir,
}: {
  alcance: "mios" | "todos";
  buscando: boolean;
  onVerTodos: () => void;
  onPedir: () => void;
}) {
  if (buscando) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
        <p className="text-sm text-slate-500">
          Nada coincide con lo que buscaste
          {alcance === "mios" && " entre tus pedidos"}.
        </p>
        {alcance === "mios" && (
          <button onClick={onVerTodos} className="mt-2 text-sm text-slate-600 underline">
            Buscar entre todos los pedidos
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
      <p className="text-sm text-slate-500">
        {alcance === "mios"
          ? "Todavía no figurás como solicitante de ningún pedido."
          : "Todavía no hay requerimientos cargados."}
      </p>
      {alcance === "mios" && (
        <>
          {/* Hoy le pasa a todo el mundo, y conviene decir por qué en vez de
              dejar que se lea como un error: los requerimientos que vinieron de
              la planilla no traen quién los pidió. Los que se carguen desde
              acá sí. */}
          <p className="mx-auto mt-2 max-w-md text-xs text-slate-400">
            Los requerimientos que vinieron de la planilla no traen quién los
            pidió, así que acá vas a ver los que cargues desde el sistema.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={onPedir}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
            >
              Pedir un material
            </button>
            <button
              onClick={onVerTodos}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Ver todos los pedidos
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}
