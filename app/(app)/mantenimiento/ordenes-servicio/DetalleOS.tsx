"use client";

import { useState } from "react";
import { fecha, monedaExacta } from "@/lib/compras/constants";
import { monto } from "@/lib/mantenimiento/planilla";
import { resumenDeCotizaciones } from "@/lib/mantenimiento/comparativas";
import { ESTADOS_OS } from "@/lib/mantenimiento/os";
import { esDenegacionDeOS } from "@/lib/mantenimiento/denegacion";
import { justificacionQueExplica } from "@/lib/core/justificacion";
import type { OrdenServicio, CotizacionOS } from "@/lib/mantenimiento/types";
import CotizacionForm from "./CotizacionForm";
import { useCargar } from "@/lib/core/useCargar";
import Select from "@/components/Select";
import { Modal } from "@/components/Modal";
import { useBorrador } from "@/lib/core/useBorrador";
import { claveDelBorrador } from "@/lib/core/borradorDeFormulario";

/**
 * Una orden de servicio abierta: cómo viene y qué se cotizó.
 *
 * Dos cosas en la misma pantalla porque se miran juntas: elegir el proveedor
 * es lo que decide el seguimiento.
 */
export default function DetalleOS({
  orden, puedeEditar, onCerrar, onCambio,
}: {
  orden: OrdenServicio;
  puedeEditar: boolean;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [cotizaciones, setCotizaciones] = useState<CotizacionOS[] | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cargandoComparativa, setCargandoComparativa] = useState(true);
  const [cargandoNueva, setCargandoNueva] = useState(false);

  /*
   * EL SEGUIMIENTO: SEIS CAMPOS QUE VIAJAN JUNTOS EN UN SOLO `PATCH`
   *
   * Por eso van **planos** en el borrador y no como un objeto: se guarda sólo el
   * que se tocó, y al volver a abrir se apoya sobre la OS **como está ahora**.
   * Guardar los seis enteros haría que retomar un borrador de ayer le devolviera
   * a los otros cinco el valor que tenían ayer, pisando lo que haya corregido
   * otro — y la app vive instalada en los teléfonos, así que «mientras esté
   * abierta» puede ser días.
   *
   * Esta pantalla **tenía un «Guardar» y ningún «Cancelar»**, y por eso se quedó
   * sin `soloLectura`: para decidir acá. La decisión es que un bloque editable
   * que puede quedar a medio escribir necesita quién lo descarte, así que al
   * lado de «Guardar» hay ahora un «Descartar los cambios» que devuelve los seis
   * campos a lo que dice la OS, y aparece sólo si hay algo cambiado. Sin él,
   * salir ofrecería conservar y nada podría tirar.
   *
   * **Una sola vara, y por eso el inicial va escrito acá adentro.** Estos seis
   * valores estaban antes en un `useState` congelado al lado del hook, y
   * «Descartar» volvía a *ése*: como `asentar()` mueve la vara del hook y no la
   * copia, después de guardar «PEDIDO» el botón devolvía los seis campos a la OS
   * de **antes** de guardar, el formulario quedaba figurando tocado y el
   * siguiente «Guardar» mandaba los valores viejos encima. Era el mismo defecto
   * que `asentar()` vino a cerrar, entrando por la otra puerta. Con una sola
   * vara no hay dos cosas que puedan separarse: quien descarta es `tirar()`.
   */
  const { valores, cambiar, tocado, tirar, asentar } = useBorrador(
    claveDelBorrador("mantenimiento-seguimiento-os", { tipo: "os", id: orden.id }),
    {
      estado: orden.estado ?? "",
      proveedor: orden.proveedor_elegido ?? "",
      fechaPedido: orden.fecha_pedido ?? "",
      fechaRealizacion: orden.fecha_realizacion ?? "",
      observaciones: orden.observaciones ?? "",
      motivoRechazo: orden.motivo_rechazo ?? "",
    },
  );
  const { estado, proveedor, fechaPedido, fechaRealizacion, observaciones, motivoRechazo } = valores;

  // Denegar le cierra la puerta a quien pidió el trabajo, así que pide el
  // motivo. El servidor lo exige igual —la regla vive en
  // `lib/mantenimiento/denegacion.ts`—; acá se dice qué se espera para no
  // dejar a nadie tocando un botón apagado sin entender por qué.
  const denegando = esDenegacionDeOS(estado);
  const faltaElMotivo = denegando && !justificacionQueExplica(motivoRechazo);

  const traerComparativa = useCargar(async (vigente) => {
    if (!orden.os_number) { setCargandoComparativa(false); return; }
    setCargandoComparativa(true);

    const res = await fetch(`/api/mantenimiento/comparativas?os=${orden.os_number}`);
    const body = await res.json().catch(() => ({}));
    if (!vigente()) return;
    setCargandoComparativa(false);

    if (!res.ok) { setError(body.error ?? "No se pudo traer la comparativa."); return; }
    setCotizaciones(body.data ?? []);
  }, [orden.os_number]);

  async function guardarSeguimiento() {
    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/ordenes-servicio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: orden.id,
        estado, proveedor_elegido: proveedor,
        fecha_pedido: fechaPedido || null,
        fecha_realizacion: fechaRealizacion || null,
        observaciones,
        motivo_rechazo: motivoRechazo,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo guardar."); return; }
    // La app ya guardó; la planilla es best-effort y su problema se muestra.
    if (body.planilla_error) setError(`Guardado, pero no se pudo escribir en la planilla: ${body.planilla_error}`);
    // `asentar()` y **no `tirar()`**, que es la diferencia que acá revierte
    // datos: este modal no se cierra al guardar y la OS que le llega por props
    // es una foto que nadie resincroniza (`OrdenesServicioClient` la guarda en
    // `abierta`, y `onCambio` es sólo un `router.refresh()`). Con `tirar()` la
    // pantalla volvía a lo de antes de editar —«Sin estado» después de haber
    // guardado «PEDIDO»— y un segundo «Guardar» mandaba los valores viejos
    // encima. Asentar deja en pantalla lo que se guardó y el formulario sin
    // tocar. Un fallo sale por el `return` de arriba, con lo escrito en su lugar.
    asentar();
    onCambio();
  }

  /** Elegir una cotización es también anotar quién hace el trabajo. */
  async function elegir(cot: CotizacionOS) {
    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/comparativas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: cot.id, eleccion: !cot.eleccion }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo elegir."); return; }
    // Elegir la cotización deja el proveedor puesto **sin guardar**, así que es
    // un cambio del formulario como cualquier otro y cuenta como tocado.
    if (!cot.eleccion) cambiar({ proveedor: cot.proveedor });
    traerComparativa();
    onCambio();
  }

  /** Sacar una cotización: se vacía su fila en la planilla y se borra acá. */
  async function borrar(cot: CotizacionOS) {
    setGuardando(true);
    setError("");

    const res = await fetch(`/api/mantenimiento/comparativas?id=${cot.id}`, { method: "DELETE" });
    setGuardando(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo borrar.");
      return;
    }
    traerComparativa();
    onCambio();
  }

  const resumen = resumenDeCotizaciones(cotizaciones ?? []);

  return (
    // El fondo, la X y Escape salen conservando: lo cambiado y todavía no
    // guardado queda y aparece igual al volver a abrir esta OS. El que tira es
    // el «Descartar los cambios» de abajo (ver el comentario del borrador).
    <Modal titulo={`OS #${orden.os_number ?? "—"}`} alSalir={onCerrar} tocado={tocado} ancho="ancho">
      <div className="space-y-5">
        <p className="-mt-2 text-xs text-slate-400">
          {orden.prioridad && (
            <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {orden.prioridad}
            </span>
          )}
          {fecha(orden.fecha)} · {orden.area ?? "sin área"} ·{" "}
          {orden.sectores?.nombre ?? orden.sector_raw ?? "sin sector"}
        </p>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-800">{orden.descripcion ?? "—"}</p>
          {orden.detalle_extra && <p className="mt-1 text-xs text-slate-500">{orden.detalle_extra}</p>}
          {orden.equipo_raw && (
            <p className="mt-1 text-xs text-slate-400">
              Equipo: {orden.equipos?.name ?? orden.equipo_raw}
              {!orden.equipment_id && " · sin enlazar al sistema"}
            </p>
          )}
        </div>

        {/* Seguimiento */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Cómo viene</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Estado">
              <Select
                value={estado}
                onChange={(e) => cambiar({ estado: e.target.value })}
                disabled={!puedeEditar || guardando}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              >
                <option value="">Sin estado</option>
                {/* Los de la planilla. Si trae uno que no está en la lista se
                    suma, para no perderlo al guardar. */}
                {[...new Set([...ESTADOS_OS, ...(estado ? [estado] : [])])].map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </Select>
            </Campo>
            <Campo etiqueta="Proveedor">
              <input
                value={proveedor}
                onChange={(e) => cambiar({ proveedor: e.target.value })}
                disabled={!puedeEditar || guardando}
                placeholder="—"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </Campo>
            <Campo etiqueta="Cuándo se pidió">
              <input
                type="date"
                value={fechaPedido?.slice(0, 10) ?? ""}
                onChange={(e) => cambiar({ fechaPedido: e.target.value })}
                disabled={!puedeEditar || guardando}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </Campo>
            <Campo etiqueta="Cuándo se hizo">
              <input
                type="date"
                value={fechaRealizacion?.slice(0, 10) ?? ""}
                onChange={(e) => cambiar({ fechaRealizacion: e.target.value })}
                disabled={!puedeEditar || guardando}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </Campo>
          </div>

          <Campo etiqueta="Observaciones">
            <textarea
              value={observaciones}
              onChange={(e) => cambiar({ observaciones: e.target.value })}
              disabled={!puedeEditar || guardando}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </Campo>

          {/* Aparece sólo al denegar: es el único estado que le debe una
              explicación a alguien. Va aparte de Observaciones, que es de uso
              general y tiene notas cargadas que no son motivos. */}
          {denegando && (
            <Campo etiqueta="Por qué se deniega">
              <textarea
                value={motivoRechazo}
                onChange={(e) => cambiar({ motivoRechazo: e.target.value })}
                disabled={!puedeEditar || guardando}
                rows={2}
                autoFocus
                placeholder="Ej.: lo hace el taller propio"
                className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
              <p className="mt-1 text-xs text-slate-500">
                Obligatorio. Queda en el sistema: la planilla no tiene esta columna.
              </p>
            </Campo>
          )}

          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={guardarSeguimiento}
                disabled={guardando || faltaElMotivo}
                title={faltaElMotivo ? "Escribí por qué se deniega" : undefined}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              {/* El único que tira: devuelve los seis campos a la última vara
                  —lo que decía la OS al abrir, o lo último que se guardó desde
                  acá—. Aparece sólo con algo cambiado, porque un botón de
                  descartar al lado de un formulario intacto no descarta nada. */}
              {tocado && (
                <button
                  onClick={tirar}
                  disabled={guardando}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Descartar los cambios
                </button>
              )}
            </div>
          )}
        </div>

        {/* Comparativa */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-800">
              Comparativa
              {/* La planilla guarda el link detrás de la palabra "LINK". */}
              {orden.comparativa?.startsWith("http") && (
                <a
                  href={orden.comparativa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-xs font-normal text-blue-600 hover:underline"
                >ver la planilla</a>
              )}
            </h3>
            <div className="flex items-center gap-3">
              {resumen.cantidad > 0 && resumen.seEligioLaMasBarata === false && (
                <span className="text-xs text-amber-700">
                  La elegida está {monedaExacta(resumen.diferencia)} por encima de la más barata.
                </span>
              )}
              {puedeEditar && !cargandoNueva && orden.os_number && (
                <button
                  onClick={() => setCargandoNueva(true)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cargar cotización
                </button>
              )}
            </div>
          </div>

          {cargandoNueva && orden.os_number && (
            <CotizacionForm
              osNumber={orden.os_number}
              sector={orden.sector_raw ?? orden.sectores?.nombre ?? null}
              onCerrar={() => setCargandoNueva(false)}
              onCargada={() => { setCargandoNueva(false); traerComparativa(); onCambio(); }}
            />
          )}

          {cargandoComparativa ? (
            <p className="py-6 text-center text-sm text-slate-400">Trayendo las cotizaciones…</p>
          ) : (cotizaciones ?? []).length === 0 ? (
            <p className="rounded-xl border border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
              Esta OS no tiene cotizaciones cargadas en la planilla de comparativas.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Proveedor</th>
                    <th className="px-3 py-2 text-right">Unitario</th>
                    <th className="px-3 py-2 text-right">IVA</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-left">Plazo</th>
                    <th className="px-3 py-2 text-left">Pago</th>
                    <th className="px-3 py-2 text-left">Vigencia</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(cotizaciones ?? []).map((c) => {
                    const esLaMasBarata = resumen.masBarata?.id === c.id;
                    return (
                      <tr key={c.id} className={c.eleccion ? "bg-emerald-50/60" : ""}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{c.proveedor}</div>
                          {c.otras_especificaciones && (
                            <div className="text-xs text-slate-400">{c.otras_especificaciones}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {monedaExacta(monto(c.precio_unitario))}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {c.iva === null ? "—" : `${Math.round(c.iva * 100)}%`}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-800">
                          {monedaExacta(monto(c.precio_total))}
                          {esLaMasBarata && (
                            <div className="text-[10px] font-normal text-emerald-700">la más barata</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{c.plazos ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{c.condiciones_pago ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{fecha(c.vigencia_hasta)}</td>
                        <td className="px-3 py-2 text-right">
                          {puedeEditar ? (
                            <button
                              onClick={() => elegir(c)}
                              disabled={guardando}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                                c.eleccion
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                  : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {c.eleccion ? "Elegida" : "Elegir"}
                            </button>
                          ) : (
                            c.eleccion && <span className="text-xs font-semibold text-emerald-700">Elegida</span>
                          )}
                          {puedeEditar && (
                            <button
                              onClick={() => borrar(c)}
                              disabled={guardando}
                              className="ml-1.5 text-xs text-slate-400 hover:text-red-600 disabled:opacity-50"
                              title="Sacar esta cotización de la comparativa"
                            >×</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-slate-600">{etiqueta}</span>
      {children}
    </label>
  );
}
