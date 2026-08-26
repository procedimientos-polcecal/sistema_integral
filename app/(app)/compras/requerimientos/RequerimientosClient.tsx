"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import NuevoRequerimientoModal from "./NuevoRequerimientoModal";
import ModalAvanzar from "./ModalAvanzar";
import type { ResumenComparativa } from "./ModalAvanzar";
import AprobarSinComparativa from "../AprobarSinComparativa";
import {
  ESTADOS_APROBACION, ESTADOS_COMPRA, PRIORIDADES,
  APROBACION_LABELS, COMPRA_LABELS, PRIORIDAD_LABELS, etiquetaPrioridad,
  moneda, fecha, diasRestantes, etiquetaEmpresa,
  SIGUIENTE_ESTADO, ACCION_SIGUIENTE, ESTADOS_CON_DIALOGO,
} from "@/lib/compras/constants";
import { costosParaElPedido } from "@/lib/compras/comparativa";
import type { FiltrosCompras } from "@/lib/compras/filtrosUrl";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

const POR_PAGINA = 50;

type Opcion = { id: string; nombre: string };
type Persona = { id: string; nombre: string; apellido: string; alias: string | null };

/** Cómo se lo nombra: el alias de la planilla si lo tiene, si no el nombre. */
function nombreCorto(p: Persona): string {
  return p.alias ?? p.nombre;
}

export default function RequerimientosClient({
  areas, proveedores, empresas, ubicaciones, aprobadores, usuarioId, canEdit,
  filtrosIniciales,
}: {
  areas: Opcion[];
  proveedores: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
  aprobadores: Persona[];
  usuarioId: string;
  canEdit: boolean;
  /** Lo que venía en la URL, ya validado por la página. */
  filtrosIniciales: FiltrosCompras;
}) {
  const [filas, setFilas] = useState<RequerimientoConRelaciones[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  // Los filtros arrancan con lo que trajo la URL: es como el tablero lleva a
  // cada etapa. De ahí en más los maneja la pantalla; la URL no se reescribe al
  // tocar un desplegable, es el punto de entrada y no un espejo del estado.
  const [busqueda, setBusqueda] = useState(filtrosIniciales.busqueda);
  const [busquedaAplicada, setBusquedaAplicada] = useState(filtrosIniciales.busqueda);
  const [area, setArea] = useState(filtrosIniciales.area);
  const [aprobacion, setAprobacion] = useState(filtrosIniciales.aprobacion);
  const [compra, setCompra] = useState(filtrosIniciales.compra);
  const [prioridad, setPrioridad] = useState(filtrosIniciales.prioridad);
  const [empresa, setEmpresa] = useState(filtrosIniciales.empresa);
  const [proveedor, setProveedor] = useState(filtrosIniciales.proveedor);
  const [ubicacion, setUbicacion] = useState(filtrosIniciales.ubicacion);

  // Con qué comparativa cuenta cada RI de la página. El diálogo lo usa para no
  // exigir el link cuando ya hay presupuestos, y para mostrar de antemano con
  // qué proveedor y qué costo va a quedar el pedido.
  const [resumenes, setResumenes] = useState<Record<string, ResumenComparativa>>({});
  const [avanzando, setAvanzando] = useState<RequerimientoConRelaciones | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState("");

  // La búsqueda espera un momento para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => {
    setPagina(0);
  }, [busquedaAplicada, area, aprobacion, compra, prioridad, empresa, proveedor, ubicacion]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const supabase = createClient();

    let q = supabase
      .from("compras_requerimientos")
      .select(
        "*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)",
        { count: "exact" }
      );

    if (busquedaAplicada) {
      // Un número suelto se busca como N° de RI, que es como lo pide la gente.
      const comoNumero = Number(busquedaAplicada);
      if (Number.isInteger(comoNumero) && comoNumero > 0) {
        q = q.eq("nro_ri", comoNumero);
      } else {
        const p = `%${busquedaAplicada}%`;
        q = q.or(`descripcion.ilike.${p},codigo.ilike.${p},detalle_extra.ilike.${p}`);
      }
    }
    if (area) q = q.eq("area_id", area);
    if (aprobacion) q = q.eq("estado_aprobacion", aprobacion);
    if (compra) q = q.eq("estado_compra", compra);
    if (prioridad) q = q.eq("prioridad", prioridad);
    if (empresa) q = empresa === "AMBAS" ? q.is("empresa_id", null) : q.eq("empresa_id", empresa);
    if (proveedor) q = q.eq("proveedor_id", proveedor);
    if (ubicacion) q = q.eq("ubicacion_id", ubicacion);

    const desde = pagina * POR_PAGINA;
    const { data, error: err, count } = await q
      .order("nro_ri", { ascending: false })
      .range(desde, desde + POR_PAGINA - 1);

    if (err) {
      setError(err.message);
      setFilas([]);
      setResumenes({});
      setCargando(false);
      return;
    }

    const nuevas = (data ?? []) as RequerimientoConRelaciones[];
    setFilas(nuevas);
    setTotal(count ?? 0);
    setCargando(false);

    // Los presupuestos, sólo de las filas que están en pantalla.
    //
    // Se filtra por los ids y no por el estado porque son 50 como mucho: son
    // unos 2 KB de URL. Filtrar por estado traería los del histórico entero, y
    // una lista de mil ids arma una URL de 37 KB que PostgREST rechaza con 400.
    const ids = nuevas.map((f) => f.id);
    if (ids.length === 0) {
      setResumenes({});
      return;
    }

    const { data: cotizaciones } = await supabase
      .from("compras_cotizaciones")
      .select("requerimiento_id, elegida, proveedor_id, precio_total, costo_envio")
      .in("requerimiento_id", ids);

    const nombrePorProveedor = new Map(proveedores.map((p) => [p.id, p.nombre]));
    const resumen: Record<string, ResumenComparativa> = {};
    for (const c of (cotizaciones ?? []) as {
      requerimiento_id: string; elegida: boolean; proveedor_id: string;
      precio_total: number | null; costo_envio: number | null;
    }[]) {
      const r = (resumen[c.requerimiento_id] ??= { cuantos: 0, elegida: null });
      r.cuantos += 1;
      if (c.elegida) {
        r.elegida = {
          ...costosParaElPedido(c),
          proveedor_nombre: nombrePorProveedor.get(c.proveedor_id) ?? null,
        };
      }
    }
    setResumenes(resumen);
  }, [busquedaAplicada, area, aprobacion, compra, prioridad, empresa, proveedor, ubicacion, pagina, proveedores]);

  /**
   * Avanza el RI a la etapa siguiente.
   *
   * Recarga la tabla con su propia consulta y no con router.refresh(): las
   * filas las trae el cliente, así que refrescar el árbol de servidor no las
   * cambiaría.
   */
  async function avanzar(r: RequerimientoConRelaciones, extra?: Record<string, unknown>) {
    const destino = SIGUIENTE_ESTADO[r.estado_compra];
    if (!destino) return false;

    setProcesando(r.id);
    setErrorAccion("");
    const res = await fetch(`/api/compras/requerimientos/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado_compra: destino, ...extra }),
    });
    setProcesando(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorAccion(body.error ?? "No se pudo actualizar el estado.");
      return false;
    }
    await cargar();
    return true;
  }

  useEffect(() => { cargar(); }, [cargar]);

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const hayFiltros = !!(
    busquedaAplicada || area || aprobacion || compra || prioridad || empresa || proveedor || ubicacion
  );

  // La tabla tiene una columna más cuando se puede gestionar la compra.
  const columnas = canEdit ? 13 : 12;

  const totalPantalla = useMemo(
    () => filas.reduce((acc, f) => acc + (f.costo_iva ?? 0) + (f.costo_envio ?? 0), 0),
    [filas]
  );

  function limpiar() {
    setBusqueda(""); setArea(""); setAprobacion(""); setCompra("");
    setPrioridad(""); setEmpresa(""); setProveedor(""); setUbicacion("");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Requerimientos internos</h1>
          <p className="text-sm text-slate-500">
            {cargando ? "Cargando…" : `${total.toLocaleString("es-AR")} requerimiento${total === 1 ? "" : "s"}`}
            {hayFiltros && !cargando ? " con los filtros aplicados" : ""}
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
        >
          + Nuevo requerimiento
        </button>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-9">
          <input
            className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Buscar texto o N° de RI…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <Select value={area} onChange={setArea} vacio="Todas las áreas"
            opciones={areas.map((a) => [a.id, a.nombre])} />
          <Select value={aprobacion} onChange={setAprobacion} vacio="Toda aprobación"
            opciones={ESTADOS_APROBACION.map((e) => [e, APROBACION_LABELS[e].label])} />
          <Select value={compra} onChange={setCompra} vacio="Toda compra"
            opciones={ESTADOS_COMPRA.map((e) => [e, COMPRA_LABELS[e].label])} />
          <Select value={prioridad} onChange={setPrioridad} vacio="Toda prioridad"
            opciones={PRIORIDADES.map((p) => [p, PRIORIDAD_LABELS[p].label])} />
          <Select value={empresa} onChange={setEmpresa} vacio="Cualquier empresa"
            opciones={[...empresas.map((e) => [e.id, e.nombre] as [string, string]), ["AMBAS", "Ambas"]]} />
          <Select value={proveedor} onChange={setProveedor} vacio="Todo proveedor"
            opciones={proveedores.map((p) => [p.id, p.nombre])} />
          <Select value={ubicacion} onChange={setUbicacion} vacio="Cualquier ubicación"
            opciones={ubicaciones.map((u) => [u.id, u.nombre])} />
        </div>
        {hayFiltros && (
          <button onClick={limpiar} className="mt-2 text-xs text-slate-500 hover:text-slate-800">
            Limpiar filtros
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No se pudieron cargar los requerimientos: {error}
        </div>
      )}

      {errorAccion && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorAccion}
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">N° RI</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="px-3 py-2 text-left">Área</th>
                <th className="px-3 py-2 text-left">Dónde</th>
                <th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-left">Prioridad</th>
                <th className="px-3 py-2 text-left">Paga</th>
                <th className="px-3 py-2 text-left">Aprobación</th>
                <th className="px-3 py-2 text-left">Compra</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-right">Costo + IVA</th>
                {canEdit && <th className="px-3 py-2 text-left">Acción</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={columnas} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={columnas} className="px-3 py-10 text-center text-slate-400">
                  {hayFiltros ? "Ningún requerimiento coincide con los filtros." : "Todavía no hay requerimientos cargados."}
                </td></tr>
              ) : (
                filas.map((f) => {
                  const dias = f.estado_compra === "RECIBIDO" ? null : diasRestantes(f.fecha_necesidad);
                  const vencido = dias !== null && dias < 0;
                  const donde = f.compras_ubicaciones?.nombre ?? f.ubicacion_raw;
                  return (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono">
                        <Link href={`/compras/requerimientos/${f.id}`} className="font-semibold text-[var(--primary)] hover:underline">
                          {f.nro_ri}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fecha(f.fecha)}</td>
                      <td className="max-w-xs px-3 py-2">
                        <Link href={`/compras/requerimientos/${f.id}`} className="text-slate-900 hover:underline">
                          {f.descripcion}
                        </Link>
                        {f.codigo && <div className="font-mono text-xs text-slate-400">{f.codigo}</div>}
                        {vencido && (
                          <div className="text-xs font-semibold text-red-600">
                            Vencido hace {Math.abs(dias!)} día{Math.abs(dias!) === 1 ? "" : "s"}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{f.compras_areas?.nombre ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{donde ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{f.cantidad ?? "—"}</td>
                      <td className="px-3 py-2"><Chip {...etiquetaPrioridad(f.prioridad)} /></td>
                      <td className="px-3 py-2 text-slate-600">{etiquetaEmpresa(f.empresas?.nombre, f.paga_ambas)}</td>
                      <td className="px-3 py-2"><Chip {...APROBACION_LABELS[f.estado_aprobacion]} /></td>
                      <td className="px-3 py-2"><Chip {...COMPRA_LABELS[f.estado_compra]} /></td>
                      <td className="px-3 py-2 text-slate-600">{f.proveedores?.nombre ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-slate-700">
                        {moneda(f.costo_iva)}
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap px-3 py-2">
                          <Accion
                            r={f}
                            aprobadores={aprobadores}
                            usuarioId={usuarioId}
                            procesando={procesando === f.id}
                            onAvanzar={() =>
                              ESTADOS_CON_DIALOGO.includes(f.estado_compra)
                                ? setAvanzando(f)
                                : avanzar(f)
                            }
                          />
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!cargando && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
            <div>
              Mostrando {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, total)} de {total.toLocaleString("es-AR")}
              {totalPantalla > 0 && <> · en pantalla: <strong className="font-mono">{moneda(totalPantalla)}</strong></>}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={pagina === 0}
                onClick={() => setPagina((p) => p - 1)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              >
                ← Anterior
              </button>
              <span>Página {pagina + 1} de {paginas}</span>
              <button
                disabled={pagina + 1 >= paginas}
                onClick={() => setPagina((p) => p + 1)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Aprobar la compra tiene su propio diálogo: no exige nada, avisa que va
          sin comparativa y ofrece cargar el proveedor y el costo. Antes este
          botón avanzaba a ciegas, sin avisar ni dejar cargar nada, mientras la
          bandeja ni siquiera lo ofrecía. */}
      {avanzando?.estado_compra === "PARA_COMPRAR" && (
        <div
          onClick={() => setAvanzando(null)}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-20 w-full max-w-lg rounded-xl bg-white shadow-xl"
          >
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900">Aprobar la compra</h2>
              <p className="text-sm text-slate-500">
                RI {avanzando.nro_ri} · {avanzando.descripcion}
              </p>
            </div>
            <div className="px-6 py-5">
              <AprobarSinComparativa
                proveedores={proveedores}
                presupuestosSinMirar={resumenes[avanzando.id]?.cuantos ?? 0}
                aprobando={procesando === avanzando.id}
                onAprobar={async (datos) => {
                  const ok = await avanzar(avanzando, datos);
                  if (ok) setAvanzando(null);
                }}
                onCancelar={() => setAvanzando(null)}
              />
            </div>
          </div>
        </div>
      )}

      {avanzando && avanzando.estado_compra !== "PARA_COMPRAR" && (
        <ModalAvanzar
          requerimiento={avanzando}
          aprobadores={aprobadores}
          proveedores={proveedores}
          comparativa={resumenes[avanzando.id] ?? { cuantos: 0, elegida: null }}
          onClose={() => setAvanzando(null)}
          onConfirmar={(extra) => avanzar(avanzando, extra)}
        />
      )}

      {modalAbierto && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          onClose={() => setModalAbierto(false)}
          onSaved={() => { setModalAbierto(false); cargar(); }}
        />
      )}
    </div>
  );
}

/**
 * El paso siguiente de una fila, si lo hay.
 *
 * No toda fila tiene uno, y decir por qué importa tanto como ofrecer el botón:
 *
 *  - sin aprobación de gerencia el circuito de compra ni siquiera arrancó
 *  - en PEDIDO, RECIBIDO o DENEGADO no hay paso que dar desde acá
 *  - en PARA_COMPRAR el paso es de quien la tiene asignada y de nadie más: en
 *    la planilla el estado dice a quién le toca, y que apruebe otro dejaría los
 *    dos lados diciendo cosas distintas
 */
function Accion({
  r, aprobadores, usuarioId, procesando, onAvanzar,
}: {
  r: RequerimientoConRelaciones;
  aprobadores: Persona[];
  usuarioId: string;
  procesando: boolean;
  onAvanzar: () => void;
}) {
  const siguiente = SIGUIENTE_ESTADO[r.estado_compra];
  const tenue = "text-xs text-slate-400";

  if (r.estado_aprobacion !== "APROBADA") {
    return <span className={tenue}>Sin aprobar</span>;
  }
  if (!siguiente) return <span className={tenue}>—</span>;

  if (r.estado_compra === "PARA_COMPRAR" && r.compra_asignada_a !== usuarioId) {
    const quien = aprobadores.find((a) => a.id === r.compra_asignada_a);
    return (
      <span className={tenue}>
        {quien ? `Espera a ${nombreCorto(quien)}` : "Sin asignar"}
      </span>
    );
  }

  return (
    <button
      onClick={onAvanzar}
      disabled={procesando}
      className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {procesando ? "Actualizando…" : `${ACCION_SIGUIENTE[r.estado_compra] ?? "Avanzar"} →`}
    </button>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}

function Select({
  value, onChange, vacio, opciones,
}: {
  value: string;
  onChange: (v: string) => void;
  vacio: string;
  opciones: [string, string][];
}) {
  return (
    <select
      className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{vacio}</option>
      {opciones.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}
