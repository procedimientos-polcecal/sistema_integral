"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  COLUMNAS_TABLERO, SIGUIENTE_ESTADO, ACCION_SIGUIENTE, COMPRA_LABELS,
  etiquetaPrioridad, pesoPrioridad, moneda, fecha, diasRestantes, etiquetaEmpresa,
  ESTADOS_QUE_PIDEN_DATOS,
} from "@/lib/compras/constants";

import type { RequerimientoConRelaciones, EstadoCompra } from "@/lib/compras/types";

type Persona = { id: string; nombre: string; apellido: string; alias: string | null };

/**
 * Con qué comparativa cuenta un RI.
 *
 * Lo arma la página, que es la que puede consultar la base. El tablero lo usa
 * para no pedir dos veces lo que ya está cargado.
 */
export interface ResumenComparativa {
  cuantos: number;
  elegida: {
    proveedor_id: string;
    proveedor_nombre: string | null;
    costo_iva: number;
    costo_envio: number;
  } | null;
}

/**
 * Un color por aprobador, para distinguir de un vistazo lo de cada uno.
 *
 * Sale del orden en la lista y no de un hash: con dos o tres personas el hash
 * puede darles tonos parecidos, que es justo lo que hay que evitar.
 */
const COLORES_APROBADOR = [
  { chip: "bg-violet-100 text-violet-800", borde: "border-l-violet-400" },
  { chip: "bg-cyan-100 text-cyan-800", borde: "border-l-cyan-400" },
  { chip: "bg-rose-100 text-rose-800", borde: "border-l-rose-400" },
  { chip: "bg-lime-100 text-lime-800", borde: "border-l-lime-400" },
];

/** Cómo se lo nombra: el alias de la planilla si lo tiene, si no el nombre. */
function nombreCorto(p: Persona): string {
  return p.alias ?? p.nombre;
}

export default function TableroClient({
  requerimientos, aprobadores, proveedores, usuarioId, canEdit, resumen,
  pedidosViejos, diasDePedido,
}: {
  requerimientos: RequerimientoConRelaciones[];
  aprobadores: Persona[];
  proveedores: { id: string; nombre: string }[];
  usuarioId: string;
  canEdit: boolean;
  resumen: Record<string, ResumenComparativa>;
  /** Pedidos que quedaron fuera de la ventana del tablero. */
  pedidosViejos: number;
  diasDePedido: number;
}) {
  const router = useRouter();
  const [procesando, setProcesando] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Cada paso deja algo cargado; el modal junta esos datos antes de avanzar.
  const [avanzando, setAvanzando] = useState<RequerimientoConRelaciones | null>(null);
  // Filtro por a quién le toca aprobar: "" todos, "MIO" lo propio, o un id.
  const [asignado, setAsignado] = useState("");
  const [area, setArea] = useState("");
  const [empresa, setEmpresa] = useState("");

  const areas = useMemo(
    () => [...new Set(requerimientos.map((r) => r.compras_areas?.nombre).filter(Boolean) as string[])].sort(),
    [requerimientos]
  );

  const filtrados = useMemo(() => {
    let base = requerimientos;
    if (area) base = base.filter((r) => r.compras_areas?.nombre === area);
    if (asignado) {
      base = base.filter((r) =>
        asignado === "MIO"
          ? r.compra_asignada_a === usuarioId
          : r.compra_asignada_a === asignado
      );
    }
    if (empresa) {
      base = base.filter((r) =>
        empresa === "AMBAS" ? r.empresa_id === null : r.empresas?.nombre === empresa
      );
    }
    return [...base].sort(
      (a, b) =>
        pesoPrioridad(a.prioridad) - pesoPrioridad(b.prioridad) ||
        new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
    );
  }, [requerimientos, area, empresa, asignado, usuarioId]);

  const comprometido = useMemo(
    () => filtrados.reduce((acc, r) => acc + (r.costo_iva ?? 0) + (r.costo_envio ?? 0), 0),
    [filtrados]
  );

  async function avanzar(r: RequerimientoConRelaciones, extra?: Record<string, unknown>) {
    const destino = SIGUIENTE_ESTADO[r.estado_compra];
    if (!destino) return false;

    setProcesando(r.id);
    setError("");
    const res = await fetch(`/api/compras/requerimientos/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado_compra: destino, ...extra }),
    });
    setProcesando(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo actualizar el estado.");
      return false;
    }
    router.refresh();
    return true;
  }

  /**
   * Aprobar la compra es de quien la tiene asignada, no de Compras: en la
   * planilla el estado dice a quién le toca, y que apruebe otro dejaría los dos
   * lados diciendo cosas distintas.
   */
  function puedeAvanzar(r: RequerimientoConRelaciones): boolean {
    if (r.estado_compra === "PARA_COMPRAR") return r.compra_asignada_a === usuarioId;
    return canEdit;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Tablero de compras</h1>
        <p className="text-sm text-slate-500">
          {filtrados.length} requerimiento{filtrados.length === 1 ? "" : "s"} aprobados en curso
          {comprometido > 0 && <> · comprometido: <strong className="font-mono">{moneda(comprometido)}</strong></>}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          <option value="">Todas las áreas</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
        >
          <option value="">Cualquier empresa</option>
          <option value="POLCECAL">POLCECAL</option>
          <option value="POLYSAN">POLYSAN</option>
          <option value="AMBAS">Ambas</option>
        </select>

        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={asignado}
          onChange={(e) => setAsignado(e.target.value)}
        >
          <option value="">Aprueba cualquiera</option>
          {aprobadores.some((a) => a.id === usuarioId) && (
            <option value="MIO">Las que apruebo yo</option>
          )}
          {aprobadores.map((a) => (
            <option key={a.id} value={a.id}>Aprueba {nombreCorto(a)}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!canEdit && (
        <p className="text-sm text-slate-500">
          Estás viendo el tablero en modo consulta. Gestionar compras requiere nivel de edición.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNAS_TABLERO.map((columna) => {
          const items = filtrados.filter((r) => r.estado_compra === columna);
          const totalColumna = items.reduce((acc, r) => acc + (r.costo_iva ?? 0) + (r.costo_envio ?? 0), 0);
          const siguiente = SIGUIENTE_ESTADO[columna] as EstadoCompra | undefined;

          return (
            <section key={columna} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COMPRA_LABELS[columna].color}`}>
                  {COMPRA_LABELS[columna].label}
                </span>
                <span className="text-xs text-slate-500">
                  {items.length}{totalColumna > 0 && ` · ${moneda(totalColumna)}`}
                </span>
              </header>

              {/* Un recorte que no se avisa se lee como "no hay nada más". */}
              {columna === "PEDIDO" && pedidosViejos > 0 && (
                <p className="border-b border-slate-200 px-4 py-2 text-[11px] text-slate-500">
                  Últimos {diasDePedido} días. Hay {pedidosViejos} pedidos anteriores:
                  {" "}
                  <Link href="/compras/requerimientos?estado_compra=PEDIDO" className="text-[var(--primary)] hover:underline">
                    verlos en requerimientos
                  </Link>
                </p>
              )}

              {columna === "PARA_COMPRAR" && items.length > 0 && (
                <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-2">
                  {aprobadores.map((a, i) => {
                    const cuantas = items.filter((r) => r.compra_asignada_a === a.id).length;
                    if (cuantas === 0) return null;
                    const c = COLORES_APROBADOR[i % COLORES_APROBADOR.length];
                    return (
                      <span key={a.id} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.chip}`}>
                        {nombreCorto(a)}: {cuantas}
                      </span>
                    );
                  })}
                  {items.some((r) => !r.compra_asignada_a) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      sin asignar: {items.filter((r) => !r.compra_asignada_a).length}
                    </span>
                  )}
                </div>
              )}

              <div className="max-h-[70vh] space-y-2 overflow-y-auto p-3">
                {items.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">Nada en esta etapa.</p>
                ) : (
                  items.map((r) => {
                    const dias = diasRestantes(r.fecha_necesidad);
                    const vencido = dias !== null && dias < 0;
                    const donde = r.compras_ubicaciones?.nombre ?? r.ubicacion_raw;

                    // A quién le toca, o quién ya la aprobó según la etapa.
                    const idQuien =
                      r.estado_compra === "PARA_COMPRAR"
                        ? r.compra_asignada_a
                        : r.compra_aprobada_por ?? r.compra_asignada_a;
                    const indice = aprobadores.findIndex((a) => a.id === idQuien);
                    const quien = indice >= 0 ? aprobadores[indice] : null;
                    const color = quien ? COLORES_APROBADOR[indice % COLORES_APROBADOR.length] : null;
                    return (
                      <article
                        key={r.id}
                        className={`rounded-lg border bg-white p-3 ${
                          vencido
                            ? "border-l-4 border-l-red-500 border-slate-200"
                            : quien && color
                            ? `border-l-4 ${color.borde} border-slate-200`
                            : "border-slate-200"
                        }`}
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/compras/requerimientos/${r.id}`}
                            className="font-mono text-xs font-semibold text-[var(--primary)] hover:underline"
                          >
                            RI {r.nro_ri}
                          </Link>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${etiquetaPrioridad(r.prioridad).color}`}>
                            {etiquetaPrioridad(r.prioridad).label}
                          </span>
                          <span className="text-[11px] text-slate-400">{etiquetaEmpresa(r.empresas?.nombre, r.paga_ambas)}</span>

                          {quien && color && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${color.chip}`}
                              title={`${quien.nombre} ${quien.apellido}`}
                            >
                              {r.estado_compra === "PARA_COMPRAR" ? "→ " : "✓ "}
                              {nombreCorto(quien)}
                            </span>
                          )}
                        </div>

                        <Link
                          href={`/compras/requerimientos/${r.id}`}
                          className="block text-sm leading-snug text-slate-900 hover:underline"
                        >
                          {r.descripcion}
                        </Link>

                        <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                          <div>{r.compras_areas?.nombre ?? "Sin área"}{donde ? ` · ${donde}` : ""}</div>
                          {r.proveedores?.nombre && <div>Proveedor: {r.proveedores.nombre}</div>}
                          {r.costo_iva !== null && <div className="font-mono">{moneda(r.costo_iva)}</div>}
                          <div className={vencido ? "font-semibold text-red-600" : ""}>
                            {r.fecha_necesidad
                              ? vencido
                                ? `Vencido hace ${Math.abs(dias!)} d`
                                : `Se necesita el ${fecha(r.fecha_necesidad)}`
                              : "Sin fecha límite"}
                          </div>
                        </div>

                        {siguiente && puedeAvanzar(r) && (
                          <button
                            onClick={() =>
                              ESTADOS_QUE_PIDEN_DATOS.includes(r.estado_compra) ? setAvanzando(r) : avanzar(r)
                            }
                            disabled={procesando === r.id}
                            className="mt-2.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {procesando === r.id
                              ? "Actualizando…"
                              : `${ACCION_SIGUIENTE[r.estado_compra] ?? "Avanzar"} →`}
                          </button>
                        )}

                        {r.estado_compra === "PARA_COMPRAR" && r.compra_asignada_a !== usuarioId && (
                          <p className="mt-2 text-[11px] text-slate-400">
                            Esperando el visto bueno de quien la tiene asignada.
                          </p>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      {avanzando && (
        <ModalAvanzar
          requerimiento={avanzando}
          aprobadores={aprobadores}
          proveedores={proveedores}
          comparativa={resumen[avanzando.id] ?? { cuantos: 0, elegida: null }}
          onClose={() => setAvanzando(null)}
          onConfirmar={(extra) => avanzar(avanzando, extra)}
        />
      )}
    </div>
  );
}

/**
 * Junta lo que hace falta antes de avanzar.
 *
 * Cada paso del circuito deja algo cargado: la comparativa y a quien le toca
 * aprobarla, o el proveedor y el costo del pedido. Pedirlo aca evita llegar a
 * PEDIDO sin con que seguir la compra despues.
 */
function ModalAvanzar({
  requerimiento: r, aprobadores, proveedores, comparativa, onClose, onConfirmar,
}: {
  requerimiento: RequerimientoConRelaciones;
  aprobadores: Persona[];
  proveedores: { id: string; nombre: string }[];
  comparativa: ResumenComparativa;
  onClose: () => void;
  onConfirmar: (extra: Record<string, unknown>) => Promise<boolean>;
}) {
  const destino = SIGUIENTE_ESTADO[r.estado_compra]!;
  const esComparativa = destino === "PARA_COMPRAR";

  const elegida = comparativa.elegida;

  const [enlace, setEnlace] = useState(r.comparativa_url ?? "");
  const [asignadoA, setAsignadoA] = useState(r.compra_asignada_a ?? "");

  // El pedido arranca con lo que dejó el presupuesto elegido en vez de en
  // blanco: es lo que la ruta va a guardar igual, y verlo antes permite
  // corregirlo si hace falta.
  const [proveedorId, setProveedorId] = useState(r.proveedor_id ?? elegida?.proveedor_id ?? "");
  const [costoIva, setCostoIva] = useState(
    r.costo_iva !== null ? String(r.costo_iva) : elegida ? String(elegida.costo_iva) : ""
  );
  const [costoEnvio, setCostoEnvio] = useState(
    r.costo_envio !== null ? String(r.costo_envio) : elegida ? String(elegida.costo_envio) : ""
  );
  const [guardando, setGuardando] = useState(false);

  // Cuántos presupuestos alcanza lo decide Compras. Lo que hace falta es que
  // haya algo que mirar: presupuestos cargados en el sistema, o el link a una
  // planilla, que es como quedaron los RI históricos.
  const hayPresupuestos = comparativa.cuantos > 0;

  const listo = esComparativa
    ? Boolean(asignadoA && (hayPresupuestos || enlace.trim()))
    : Boolean(proveedorId && costoIva);

  async function confirmar() {
    setGuardando(true);
    const ok = await onConfirmar(
      esComparativa
        ? {
            compra_asignada_a: asignadoA,
            // El link se manda sólo si se escribió: cuando la comparativa vive
            // en el sistema no hay que pisar lo que ya apunta a la planilla.
            ...(enlace.trim() ? { comparativa_url: enlace.trim() } : {}),
          }
        : {
            proveedor_id: proveedorId,
            costo_iva: Number(costoIva),
            costo_envio: costoEnvio === "" ? null : Number(costoEnvio),
          }
    );
    setGuardando(false);
    if (ok) onClose();
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
    >
      <div onClick={(e) => e.stopPropagation()} className="mt-20 w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            {esComparativa ? "Comparativa lista" : "Registrar el pedido"}
          </h2>
          <p className="text-sm text-slate-500">RI {r.nro_ri} · {r.descripcion}</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          {esComparativa ? (
            <>
              {hayPresupuestos ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                  <p className="text-slate-700">
                    {comparativa.cuantos} presupuesto{comparativa.cuantos === 1 ? "" : "s"} cargado
                    {comparativa.cuantos === 1 ? "" : "s"}.
                  </p>
                  <Link
                    href={`/compras/requerimientos/${r.id}`}
                    className="text-xs text-[var(--primary)] hover:underline"
                  >
                    Ver la comparativa o cargar otro →
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                    <p>Todavía no hay presupuestos cargados.</p>
                    <Link
                      href={`/compras/requerimientos/${r.id}`}
                      className="text-xs font-semibold hover:underline"
                    >
                      Cargarlos en la ficha del pedido →
                    </Link>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      O el enlace a una planilla
                    </span>
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={enlace}
                      onChange={(e) => setEnlace(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                </div>
              )}

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  A quien le toca aprobarla
                </span>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={asignadoA}
                  onChange={(e) => setAsignadoA(e.target.value)}
                >
                  <option value="">Elegir…</option>
                  {aprobadores.map((a) => (
                    <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Es lo que va entre parentesis en el estado de la planilla, y solo esa
                  persona va a poder aprobarla.
                </p>
              </label>
            </>
          ) : (
            <>
              {elegida && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                  Sale del presupuesto que se aprobó
                  {elegida.proveedor_nombre ? `, de ${elegida.proveedor_nombre}` : ""}. Si algo
                  cambió al hacer el pedido, corregilo acá.
                </p>
              )}

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Proveedor elegido
                </span>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={proveedorId}
                  onChange={(e) => setProveedorId(e.target.value)}
                  autoFocus
                >
                  <option value="">Elegir…</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Costo + IVA
                  </span>
                  <input
                    type="number" step="0.01" min="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={costoIva}
                    onChange={(e) => setCostoIva(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Envio
                  </span>
                  <input
                    type="number" step="0.01" min="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={costoEnvio}
                    onChange={(e) => setCostoEnvio(e.target.value)}
                    placeholder="Si tiene"
                  />
                </label>
              </div>

              <p className="text-xs text-slate-500">
                La fecha de pedido se registra sola con la de hoy.
              </p>
            </>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={guardando}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={confirmar}
              disabled={guardando || !listo}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : `Pasar a ${COMPRA_LABELS[destino].label}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
