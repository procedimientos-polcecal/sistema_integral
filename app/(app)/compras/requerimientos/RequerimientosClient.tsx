"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import NuevoRequerimientoModal from "./NuevoRequerimientoModal";
import {
  ESTADOS_APROBACION, ESTADOS_COMPRA, PRIORIDADES,
  APROBACION_LABELS, COMPRA_LABELS, PRIORIDAD_LABELS, etiquetaPrioridad,
  moneda, fecha, diasRestantes, etiquetaEmpresa,
} from "@/lib/compras/constants";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

const POR_PAGINA = 50;

type Opcion = { id: string; nombre: string };

export default function RequerimientosClient({
  areas, proveedores, empresas, ubicaciones, canEdit,
}: {
  areas: Opcion[];
  proveedores: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
  canEdit: boolean;
}) {
  const [filas, setFilas] = useState<RequerimientoConRelaciones[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [area, setArea] = useState("");
  const [aprobacion, setAprobacion] = useState("");
  const [compra, setCompra] = useState("");
  const [prioridad, setPrioridad] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [ubicacion, setUbicacion] = useState("");

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
    } else {
      setFilas((data ?? []) as RequerimientoConRelaciones[]);
      setTotal(count ?? 0);
    }
    setCargando(false);
  }, [busquedaAplicada, area, aprobacion, compra, prioridad, empresa, proveedor, ubicacion, pagina]);

  useEffect(() => { cargar(); }, [cargar]);

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const hayFiltros = !!(
    busquedaAplicada || area || aprobacion || compra || prioridad || empresa || proveedor || ubicacion
  );

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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={12} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={12} className="px-3 py-10 text-center text-slate-400">
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
