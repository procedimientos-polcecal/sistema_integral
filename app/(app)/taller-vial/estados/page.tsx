import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTallerVialDe } from "@/lib/tallerVial/auth";
import { traerEquiposTallerVial, traerEstadosDiarios } from "@/lib/tallerVial/consultas";
import { estadoActualPorEquipo, type EstadoDiario } from "@/lib/tallerVial/estados";
import { hoyEnArgentina } from "@/lib/core/fechas";
import EstadosClient from "./EstadosClient";

/**
 * Cambiar el estado de un equipo (Operativo / Fuera de servicio / Operativo
 * con fallas). Pivote del 18/09/2026: se carga desde acá — ver la migración
 * 20260918101859 y `/api/taller-vial/estados`, que además exporta hacia la
 * planilla real.
 */
export default async function EstadosTallerVialPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTallerVialDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const [equipos, todosLosEstados] = await Promise.all([
    traerEquiposTallerVial(supabase),
    traerEstadosDiarios(supabase, {}),
  ]);

  const estadosPlanos = todosLosEstados.map((e) => ({ equipoId: e.equipo_id, fecha: e.fecha, estado: e.estado as EstadoDiario }));
  const estadoActual: Record<string, EstadoDiario> = Object.fromEntries(estadoActualPorEquipo(estadosPlanos));

  const historial = [...todosLosEstados]
    .sort((a, b) => (a.fecha === b.fecha ? 0 : a.fecha < b.fecha ? 1 : -1))
    .slice(0, 30);

  return (
    <EstadosClient
      equipos={equipos}
      estadoActual={estadoActual}
      historial={historial}
      hoy={hoyEnArgentina()}
      puedeEditar={permisos.puedeEditar}
    />
  );
}
