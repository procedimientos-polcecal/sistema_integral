"use client";

import RequerimientosPendientes from "./RequerimientosPendientes";
import OrdenesServicioPendientes from "./OrdenesServicioPendientes";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";
import type { OrdenServicio } from "@/lib/mantenimiento/types";

/**
 * Todo lo que espera una decisión, en una sola pantalla.
 *
 * Son dos colas y no una: los requerimientos piden materiales y las órdenes de
 * servicio piden trabajo a un tercero. Van una debajo de la otra y no en
 * solapas porque son once y doce —quien aprueba entra una vez y ve todo lo que
 * le toca— y no mezcladas porque las fichas se leen distinto: un RI trae
 * cantidad, quién paga y para cuándo se necesita; una OS trae el equipo y el
 * sector donde hay que ir a trabajar.
 *
 * Las dos secciones no dependen de la misma lista de aprobadores: un servicio y
 * un material no los decide necesariamente la misma persona. Por eso cada una
 * recibe su propio permiso y quien tenga uno solo ve la otra en modo consulta.
 */
export default function AprobacionesClient({
  pendientes,
  ordenesServicio,
  puedeAprobar,
  puedeAprobarOS,
}: {
  pendientes: RequerimientoConRelaciones[];
  ordenesServicio: OrdenServicio[];
  puedeAprobar: boolean;
  puedeAprobarOS: boolean;
}) {
  const total = pendientes.length + ordenesServicio.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Aprobaciones pendientes</h1>
        <p className="text-sm text-slate-500">
          {total === 0
            ? "No hay nada esperando decisión."
            : `${total} cosa${total === 1 ? "" : "s"} esperando decisión: ` +
              `${pendientes.length} requerimiento${pendientes.length === 1 ? "" : "s"} y ` +
              `${ordenesServicio.length} orden${ordenesServicio.length === 1 ? "" : "es"} de servicio`}
        </p>
      </div>

      <RequerimientosPendientes pendientes={pendientes} puedeAprobar={puedeAprobar} />

      <OrdenesServicioPendientes
        pendientes={ordenesServicio}
        puedeAprobar={puedeAprobarOS}
      />
    </div>
  );
}
