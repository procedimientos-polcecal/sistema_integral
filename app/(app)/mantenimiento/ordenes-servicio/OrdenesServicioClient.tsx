"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fecha, moneda } from "@/lib/compras/constants";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";
import type { OrdenServicio } from "@/lib/mantenimiento/types";
import DetalleOS from "./DetalleOS";
import ProveedoresDesconocidos from "../ProveedoresDesconocidos";
import Select from "@/components/Select";
import MultiSelect from "@/components/MultiSelect";
import {
  FILTROS_OS_VACIOS, CAMPOS_DE_FECHA_OS, ENLACES_OS,
  opcionesDeLasOrdenes, filtrarOrdenesDeServicio, cuantosFiltrosPuestos,
  type FiltrosOs,
} from "@/lib/mantenimiento/filtrosOs";

/**
 * Las órdenes de servicio.
 *
 * Las OS **no se crean acá**: se piden por el formulario de Google, que es de
 * donde la planilla las importa. Lo que se hace en esta pantalla es buscar una,
 * ver su comparativa y anotar cómo viene: cuándo se pidió, quién lo hace,
 * cuándo se terminó.
 */
export default function OrdenesServicioClient({
  ordenes, cotizacionesPorOS, puedeEditar, sync
}: {
  ordenes: OrdenServicio[];
  cotizacionesPorOS: Record<number, number>;
  puedeEditar: boolean;
  /** Cuándo se trajo por última vez lo de la planilla. */
  sync: UltimaSync | null;
}) {
  const router = useRouter();
  const [filtros, setFiltros] = useState<FiltrosOs>(FILTROS_OS_VACIOS);
  // En el teléfono la fila de filtros arranca cerrada: catorce controles
  // empujarían la tabla fuera de la pantalla antes de que se vea una orden.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [abierta, setAbierta] = useState<OrdenServicio | null>(null);
  const [sinProveedor, setSinProveedor] = useState<string[]>([]);

  // Qué se puede elegir en cada desplegable. Sale de las órdenes que hay —cada
  // pestaña de la planilla escribe lo suyo— salvo el estado y la prioridad,
  // que tienen vocabulario propio. El porqué está en `filtrosOs.ts`.
  const opciones = useMemo(() => opcionesDeLasOrdenes(ordenes), [ordenes]);

  const visibles = useMemo(
    () => filtrarOrdenesDeServicio(ordenes, filtros, cotizacionesPorOS),
    [ordenes, filtros, cotizacionesPorOS]
  );

  const puestos = cuantosFiltrosPuestos(filtros);

  /** Cambiar un filtro sin pisar los otros trece. */
  const poner = (cambio: Partial<FiltrosOs>) => setFiltros((f) => ({ ...f, ...cambio }));

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

    // Lo que la sincronización ya informaba y esta pantalla no mostraba.
    //
    // Se veían sólo `guardadas` y `ordenes`, así que "159 cotizaciones" no se
    // distinguía de "la planilla tiene 159": si nueve filas no entraban, quien
    // apretó el botón se iba convencido de que estaba todo. Un aviso que sólo
    // vive en la respuesta HTTP no le llega a nadie.
    const sinParsear: string[] = compBody.sin_parsear ?? [];
    const celdasRepetidas: string[] = compBody.celdas_repetidas ?? [];
    const faltan =
      typeof compBody.leidas === "number" && typeof compBody.guardadas === "number"
        ? compBody.leidas - compBody.guardadas
        : 0;

    setAviso(
      [
        hechos.length > 0 && `Se trajeron ${hechos.join(" y ")}.`,
        huerfanas.length > 0 &&
          `Ojo: ${huerfanas.length} fila${huerfanas.length === 1 ? "" : "s"} de la planilla ` +
          `tiene${huerfanas.length === 1 ? "" : "n"} seguimiento cargado pero ninguna OS al lado ` +
          `(${huerfanas.slice(0, 5).join(", ")}${huerfanas.length > 5 ? "…" : ""}). ` +
          "Hay que acomodarlas a mano en la planilla.",
        faltan > 0 &&
          `Ojo: ${faltan} cotización${faltan === 1 ? "" : "es"} de la planilla de comparativas ` +
          `quedó${faltan === 1 ? "" : "aron"} a medias —tiene${faltan === 1 ? "" : "n"} N° de OS ` +
          "o proveedor, no los dos— así que no entró" + (faltan === 1 ? "" : "aron") + ". " +
          (sinParsear.length > 0
            ? `${sinParsear.slice(0, 8).join(", ")}${sinParsear.length > 8 ? "…" : ""}.`
            : "La versión desplegada no dice cuáles."),
        celdasRepetidas.length > 0 &&
          `Ojo: ${celdasRepetidas.length} celda${celdasRepetidas.length === 1 ? "" : "s"} de la ` +
          `planilla se leyó más de una vez (${celdasRepetidas.slice(0, 5).join(", ")}). ` +
          "Quedó la última de cada una.",
        compBody.sobrantes,
      ].filter(Boolean).join(" ")
    );

    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-xl font-bold text-slate-900">Órdenes de servicio</h1>
            <UltimaSincronizacion
              cuando={sync?.created_at}
              ok={sync?.ok ?? true}
              error={sync?.error}
            />
          </div>
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filtros.busqueda}
            onChange={(e) => poner({ busqueda: e.target.value })}
            placeholder="Buscar por N°, equipo, sector, descripción, detalle, proveedor, CUIT, N° de OC…"
            className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {/* Cuántos hay puestos, y no sólo si hay alguno: con la fila cerrada
              en el teléfono un filtro se vuelve invisible, y una lista corta no
              se distingue de una lista vacía. */}
          <button
            onClick={() => setFiltrosAbiertos((v) => !v)}
            className="sm:hidden rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
          >
            {filtrosAbiertos ? "Menos filtros" : "Más filtros"}
            {puestos > 0 && ` (${puestos})`}
          </button>
          {puestos > 0 && (
            <button
              onClick={() => setFiltros(FILTROS_OS_VACIOS)}
              className="rounded-lg px-3 py-2 text-sm text-slate-500 underline hover:text-slate-900"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Dos columnas en el teléfono: siete desplegables en fila no entran en
            los 343 px útiles. */}
        <div className={`${filtrosAbiertos ? "grid" : "hidden"} sm:flex grid-cols-2 gap-2 sm:flex-wrap`}>
          <MultiSelect valores={filtros.area} onCambio={(v) => poner({ area: v })}
            vacio="Toda área" plural="áreas" opciones={opciones.area} />
          <MultiSelect valores={filtros.estado} onCambio={(v) => poner({ estado: v })}
            vacio="Todo estado" plural="estados" opciones={opciones.estado} />
          <MultiSelect valores={filtros.prioridad} onCambio={(v) => poner({ prioridad: v })}
            vacio="Toda prioridad" plural="prioridades" opciones={opciones.prioridad} />
          <MultiSelect valores={filtros.empresa} onCambio={(v) => poner({ empresa: v })}
            vacio="Toda empresa" plural="empresas" opciones={opciones.empresa} />
          <MultiSelect valores={filtros.sector} onCambio={(v) => poner({ sector: v })}
            vacio="Todo sector" plural="sectores" opciones={opciones.sector} />
          <MultiSelect valores={filtros.equipo} onCambio={(v) => poner({ equipo: v })}
            vacio="Todo equipo" plural="equipos" opciones={opciones.equipo} />
          <MultiSelect valores={filtros.proveedor} onCambio={(v) => poner({ proveedor: v })}
            vacio="Todo proveedor" plural="proveedores" opciones={opciones.proveedor} />
        </div>

        {/* Los sí o no van juntos y aparte de los desplegables: son otra clase
            de pregunta —si algo está o no está— y mezclados se pierden. */}
        <div className={`${filtrosAbiertos ? "grid" : "hidden"} sm:flex grid-cols-2 gap-2 sm:flex-wrap`}>
          <Select
            value={filtros.cotizaciones}
            onChange={(e) => poner({ cotizaciones: e.target.value as FiltrosOs["cotizaciones"] })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Con o sin comparativa</option>
            <option value="si">Con cotizaciones</option>
            <option value="no">Sin cotizaciones</option>
          </Select>
          <Select
            value={filtros.ordenCompra}
            onChange={(e) => poner({ ordenCompra: e.target.value as FiltrosOs["ordenCompra"] })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Con o sin orden de compra</option>
            <option value="si">Con N° de orden de compra</option>
            <option value="no">Sin N° de orden de compra</option>
          </Select>
          <Select
            value={filtros.costo}
            onChange={(e) => poner({ costo: e.target.value as FiltrosOs["costo"] })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Con o sin costo</option>
            <option value="si">Con costo cargado</option>
            <option value="no">Sin costo cargado</option>
          </Select>
          <Select
            value={filtros.foto}
            onChange={(e) => poner({ foto: e.target.value as FiltrosOs["foto"] })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Con o sin foto</option>
            <option value="si">Con foto</option>
            <option value="no">Sin foto</option>
          </Select>
          <Select
            value={filtros.enlace}
            onChange={(e) => poner({ enlace: e.target.value as FiltrosOs["enlace"] })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {ENLACES_OS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </Select>
        </div>

        {/* El rango va en su propia fila: son tres controles que se leen juntos
            como una frase. Cuál de las cuatro fechas se pregunta cambia la
            respuesta —"las de febrero" no son las mismas por pedido que por
            realización—, y el `max` y el `min` cruzados evitan el rango al
            revés, que devuelve cero y no dice por qué. */}
        <div className={`${filtrosAbiertos ? "flex" : "hidden"} sm:flex flex-wrap items-center gap-2`}>
          <Select
            value={filtros.campoFecha}
            onChange={(e) => poner({ campoFecha: e.target.value as FiltrosOs["campoFecha"] })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {CAMPOS_DE_FECHA_OS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </Select>
          <span className="text-sm text-slate-400">del</span>
          <input
            type="date" value={filtros.desde} max={filtros.hasta || undefined}
            onChange={(e) => poner({ desde: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="text-sm text-slate-400">al</span>
          <input
            type="date" value={filtros.hasta} min={filtros.desde || undefined}
            onChange={(e) => poner({ hasta: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {(filtros.desde || filtros.hasta) && (
            <button
              onClick={() => poner({ desde: "", hasta: "" })}
              className="text-sm text-slate-500 underline hover:text-slate-900"
            >
              Sin fechas
            </button>
          )}

          <span className="ml-0 text-sm text-slate-400 sm:ml-3">Costo de</span>
          {/* El ancho va en un `div` y no en el `input`: `.input` no está en
              juego acá, pero el patrón es el mismo y así los dos campos miden
              lo que dicen medir en cualquier pantalla. */}
          <div className="w-28">
            <input
              type="number" inputMode="decimal" value={filtros.costoDesde} placeholder="mínimo"
              onChange={(e) => poner({ costoDesde: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <span className="text-sm text-slate-400">a</span>
          <div className="w-28">
            <input
              type="number" inputMode="decimal" value={filtros.costoHasta} placeholder="máximo"
              onChange={(e) => poner({ costoHasta: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {(filtros.costoDesde || filtros.costoHasta) && (
            <button
              onClick={() => poner({ costoDesde: "", costoHasta: "" })}
              className="text-sm text-slate-500 underline hover:text-slate-900"
            >
              Sin monto
            </button>
          )}
        </div>
      </div>

      {ordenes.length === 0 ? (
        <p className="card px-5 py-8 text-center text-sm text-slate-400">
          Todavía no hay órdenes de servicio.
          {puedeEditar && " Traelas de la planilla con el botón de arriba."}
        </p>
      ) : visibles.length === 0 ? (
        /* Una tabla sin filas no dice por qué está vacía, y con catorce
           filtros —en el teléfono, además, plegados— eso se lee como "no hay
           ninguna". Dice cuántos hay puestos y ofrece sacarlos. */
        <div className="card px-5 py-8 text-center text-sm text-slate-500">
          <p>
            Ninguna de las {ordenes.length} órdenes pasa {puestos === 1 ? "el filtro" : `los ${puestos} filtros`} que hay puesto{puestos === 1 ? "" : "s"}.
          </p>
          <button
            onClick={() => setFiltros(FILTROS_OS_VACIOS)}
            className="mt-2 text-sm text-slate-600 underline hover:text-slate-900"
          >
            Limpiar los filtros
          </button>
        </div>
      ) : (
        <>
        {/* En un teléfono, tarjetas. La fila entera abre el detalle, así que la
            tarjeta también: es el mismo gesto y es lo que hace útil la pantalla
            en pantalla chica, donde el resto de las columnas no entra. */}
        <div className="space-y-2 md:hidden">
          {visibles.map((o) => {
            const cuantas = o.os_number ? cotizacionesPorOS[o.os_number] ?? 0 : 0;
            return (
              <article
                key={o.id}
                onClick={() => setAbierta(o)}
                className="cursor-pointer card p-3"
              >
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[11px] text-slate-400">
                    {o.os_number ? `OS ${o.os_number}` : "sin N°"}
                  </span>
                  {o.estado && (
                    <span className="text-xs font-semibold text-slate-700">{o.estado}</span>
                  )}
                </div>

                <p className="text-sm leading-snug text-slate-900">{o.descripcion ?? "—"}</p>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                  <span>{o.sectores?.nombre ?? o.sector_raw ?? "Sin sector"}</span>
                  {o.equipo_raw && (
                    <span>
                      · {o.equipos?.name ?? o.equipo_raw}
                      {!o.equipment_id && <span className="text-amber-700"> · sin enlazar</span>}
                    </span>
                  )}
                  <span>· {fecha(o.fecha)}</span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
                  <span className="text-slate-500">
                    {o.proveedor_elegido ?? "Sin proveedor"}
                    {cuantas > 0 && ` · ${cuantas} cotización${cuantas === 1 ? "" : "es"}`}
                  </span>
                  {o.costo !== null && (
                    <span className="font-mono text-slate-700">{moneda(o.costo)}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto card md:block">
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
        </>
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
