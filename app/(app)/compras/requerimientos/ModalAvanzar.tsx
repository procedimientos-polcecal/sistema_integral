"use client";

import { useState } from "react";
import Link from "next/link";
import { SIGUIENTE_ESTADO, COMPRA_LABELS } from "@/lib/compras/constants";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";
import SelectorProveedor from "../SelectorProveedor";
import Select from "@/components/Select";

type Persona = { id: string; nombre: string; apellido: string; alias: string | null };

/**
 * Con qué comparativa cuenta un RI.
 *
 * Lo arma quien puede consultar la base y se lo pasa al diálogo, que no
 * consulta nada por su cuenta.
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
 * Junta lo que hace falta antes de avanzar.
 *
 * Cada paso del circuito deja algo cargado: la comparativa y a quién le toca
 * aprobarla, o el proveedor y el costo del pedido. Pedirlo acá evita llegar a
 * PEDIDO sin con qué seguir la compra después.
 *
 * Vivía en el tablero, cuando el tablero era un kanban con un botón por
 * tarjeta. Ahora lo abre la columna de acción del listado; la regla de qué
 * exige cada paso no cambió.
 */
export default function ModalAvanzar({
  requerimiento: r, ficha, aprobadores, proveedores, comparativa, hayOdoo, onClose, onConfirmar,
}: {
  requerimiento: RequerimientoConRelaciones;
  /** La ficha del RI, con el listado al que volver desde ahí. */
  ficha: string;
  aprobadores: Persona[];
  proveedores: { id: string; nombre: string }[];
  comparativa: ResumenComparativa;
  /**
   * Si el sistema tiene con qué hablarle a Odoo. Lo resuelve el servidor: sin
   * esto el modal ofrecería crear una orden que no se va a crear, y el fallo
   * aparecería recién después de confirmar.
   */
  hayOdoo: boolean;
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
  const [fechaEstimada, setFechaEstimada] = useState(r.fecha_estimada_recepcion ?? "");
  // Tildado por defecto porque es lo que el sistema venía haciendo solo al
  // pasar a PEDIDO. Lo nuevo no es crearla: es poder decir que no.
  const [crearOrden, setCrearOrden] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Cuántos presupuestos alcanza lo decide Compras. Lo que hace falta es que
  // haya algo que mirar: presupuestos cargados en el sistema, o el link a una
  // planilla, que es como quedaron los RI históricos.
  const hayPresupuestos = comparativa.cuantos > 0;

  // La fecha estimada se exige igual que el proveedor y el costo: cada paso
  // deja cargado lo suyo. La misma regla la vuelve a aplicar la ruta, porque
  // una validación que vive sólo en el botón deja de existir apenas alguien
  // llame a la API de otra forma.
  const listo = esComparativa
    ? Boolean(asignadoA && (hayPresupuestos || enlace.trim()))
    : Boolean(proveedorId && costoIva && fechaEstimada);

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
            fecha_estimada_recepcion: fechaEstimada,
            // Sólo un `false` explícito saltea la orden. Cuando Odoo no está
            // configurado no se manda nada: no hay nada que saltear.
            ...(hayOdoo ? { crear_orden_odoo: crearOrden } : {}),
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
                    href={ficha}
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
                      href={ficha}
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
                <Select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={asignadoA}
                  onChange={(e) => setAsignadoA(e.target.value)}
                >
                  <option value="">Elegir…</option>
                  {aprobadores.map((a) => (
                    <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>
                  ))}
                </Select>
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
                <SelectorProveedor
                  proveedores={proveedores}
                  valor={proveedorId}
                  onCambio={setProveedorId}
                  autoFocus
                />
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

              {/*
                Para cuándo se espera que llegue.
                Va acá y no en el formulario de recepción, que es donde vivía:
                allá se cargaba cuando la cosa ya había llegado. Es la pregunta
                que no se podía contestar cuando Mantenimiento llamaba por un
                repuesto que traba una OT.
              */}
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fecha estimada de recepción
                </span>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={fechaEstimada}
                  onChange={(e) => setFechaEstimada(e.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Es lo que ve quien lo pidió. Si después cambia, se corrige en la ficha.
                </p>
              </label>

              <p className="text-xs text-slate-500">
                La fecha de pedido se registra sola con la de hoy.
              </p>

              {/*
                La orden de compra en Odoo ya se creaba sola al pasar a PEDIDO,
                y en silencio: ni el que apretaba el botón se enteraba. Decirlo
                acá es lo que la convierte en algo que se decide.
              */}
              {hayOdoo && (
                <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0"
                    checked={crearOrden}
                    onChange={(e) => setCrearOrden(e.target.checked)}
                  />
                  <span className="text-sm text-slate-700">
                    Crear la orden de compra en Odoo
                    <span className="block text-xs text-slate-500">
                      Queda en borrador, para que contabilidad facture desde ahí en vez de
                      tipearla de cero. Confirmarla es otra decisión, en la ficha.
                    </span>
                  </span>
                </label>
              )}
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
