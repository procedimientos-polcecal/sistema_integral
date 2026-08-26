"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fecha, moneda } from "@/lib/compras/constants";
import type { OrdenServicio } from "@/lib/mantenimiento/types";
import DetalleOS from "./DetalleOS";
import ProveedoresDesconocidos from "../ProveedoresDesconocidos";

/**
 * Las órdenes de servicio.
 *
 * Las OS **no se crean acá**: se piden por el formulario de Google, que es de
 * donde la planilla las importa. Lo que se hace en esta pantalla es buscar una,
 * ver su comparativa y anotar cómo viene: cuándo se pidió, quién lo hace,
 * cuándo se terminó.
 */
export default function OrdenesServicioClient({
  ordenes, cotizacionesPorOS, puedeEditar,
}: {
  ordenes: OrdenServicio[];
  cotizacionesPorOS: Record<number, number>;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [area, setArea] = useState("");
  const [estado, setEstado] = useState("");
  const [soloSinProveedor, setSoloSinProveedor] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [abierta, setAbierta] = useState<OrdenServicio | null>(null);
  const [sinProveedor, setSinProveedor] = useState<string[]>([]);

  // Las áreas y los estados salen de los datos: cada pestaña de la planilla
  // escribe los suyos y una lista fija quedaría corta en cuanto agreguen uno.
  const areas = useMemo(() => opciones(ordenes.map((o) => o.area)), [ordenes]);
  const estados = useMemo(() => opciones(ordenes.map((o) => o.estado)), [ordenes]);

  const visibles = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return ordenes.filter((o) => {
      if (area && o.area !== area) return false;
      if (estado && o.estado !== estado) return false;
      if (soloSinProveedor && o.proveedor_elegido) return false;
      if (!q) return true;
      return [String(o.os_number ?? ""), o.descripcion, o.equipo_raw, o.sector_raw, o.proveedor_elegido]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [ordenes, busqueda, area, estado, soloSinProveedor]);

  async function sincronizar() {
    setSincronizando(true);
    setError("");
    setAviso("");

    // Las dos planillas van juntas: una comparativa sin su OS no se puede leer.
    const [os, comp] = await Promise.all([
      fetch("/api/mantenimiento/ordenes-servicio/sync", { method: "POST" }),
      fetch("/api/mantenimiento/comparativas/sync", { method: "POST" }),
    ]);
    const osBody = await os.json().catch(() => ({}));
    const compBody = await comp.json().catch(() => ({}));
    setSincronizando(false);

    const problemas = [
      !os.ok && `Órdenes de servicio: ${osBody.error ?? "no se pudo sincronizar"}`,
      !comp.ok && `Comparativas: ${compBody.error ?? "no se pudo sincronizar"}`,
    ].filter(Boolean);
    if (problemas.length > 0) setError(problemas.join(" · "));

    const hechos = [
      os.ok && `${osBody.guardadas} órdenes`,
      comp.ok && `${compBody.guardadas} cotizaciones de ${compBody.ordenes} órdenes`,
    ].filter(Boolean);

    // Filas de la planilla con proveedor o costo cargados pero sin ninguna OS
    // a la izquierda: el FILTER las corrió y el seguimiento quedó colgado.
    // Los proveedores que la planilla nombra y el sistema no conoce.
    setSinProveedor([...new Set<string>([
      ...(osBody.sin_proveedor ?? []),
      ...(compBody.sin_proveedor ?? []),
    ])]);

    const huerfanas: string[] = osBody.huerfanas ?? [];
    setAviso(
      [
        hechos.length > 0 && `Se trajeron ${hechos.join(" y ")}.`,
        huerfanas.length > 0 &&
          `Ojo: ${huerfanas.length} fila${huerfanas.length === 1 ? "" : "s"} de la planilla ` +
          `tiene${huerfanas.length === 1 ? "" : "n"} seguimiento cargado pero ninguna OS al lado ` +
          `(${huerfanas.slice(0, 5).join(", ")}${huerfanas.length > 5 ? "…" : ""}). ` +
          "Hay que acomodarlas a mano en la planilla.",
      ].filter(Boolean).join(" ")
    );

    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Órdenes de servicio</h1>
          <p className="text-sm text-slate-500">
            {visibles.length === ordenes.length
              ? `${ordenes.length} orden${ordenes.length === 1 ? "" : "es"}`
              : `${visibles.length} de ${ordenes.length}`}
            {" · "}
            {ordenes.filter((o) => !o.proveedor_elegido).length} sin proveedor elegido
          </p>
        </div>

        {puedeEditar && (
          <button
            onClick={sincronizar}
            disabled={sincronizando}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {sincronizando ? "Trayendo…" : "Traer de la planilla"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {aviso && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{aviso}</div>
      )}

      <ProveedoresDesconocidos
        nombres={sinProveedor}
        puedeEditar={puedeEditar}
        onSumados={() => { setSinProveedor([]); router.refresh(); }}
      />

      <div className="flex flex-wrap gap-2">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por N°, equipo, sector, descripción, proveedor…"
          className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Cualquier área</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Cualquier estado</option>
          {estados.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloSinProveedor}
            onChange={(e) => setSoloSinProveedor(e.target.checked)}
          />
          Sin proveedor elegido
        </label>
      </div>

      {ordenes.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
          Todavía no hay órdenes de servicio.
          {puedeEditar && " Traelas de la planilla con el botón de arriba."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">N° OS</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Qué se pide</th>
                <th className="px-3 py-2 text-left">Dónde</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-right">Costo</th>
                <th className="px-3 py-2 text-left">Comparativa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((o) => {
                const cuantas = o.os_number ? cotizacionesPorOS[o.os_number] ?? 0 : 0;
                return (
                  <tr
                    key={o.id}
                    onClick={() => setAbierta(o)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{o.os_number ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{fecha(o.fecha)}</td>
                    <td className="max-w-md px-3 py-2 text-slate-700">
                      <div className="truncate">{o.descripcion ?? "—"}</div>
                      {o.equipo_raw && (
                        <div className="truncate text-xs text-slate-400">
                          {o.equipos?.name ?? o.equipo_raw}
                          {!o.equipment_id && " · sin enlazar"}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <div>{o.sectores?.nombre ?? o.sector_raw ?? "—"}</div>
                      <div className="text-xs text-slate-400">{o.area ?? ""}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{o.estado ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{o.proveedor_elegido ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{moneda(o.costo)}</td>
                    <td className="px-3 py-2">
                      {cuantas > 0 ? (
                        <span className="text-xs text-slate-500">
                          {cuantas} cotización{cuantas === 1 ? "" : "es"}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {abierta && (
        <DetalleOS
          orden={abierta}
          puedeEditar={puedeEditar}
          onCerrar={() => setAbierta(null)}
          onCambio={() => router.refresh()}
        />
      )}

    </div>
  );
}

/** Los valores distintos que hay, ordenados, sin los vacíos. */
function opciones(valores: (string | null)[]): string[] {
  return [...new Set(valores.filter((v): v is string => Boolean(v)))].sort();
}
