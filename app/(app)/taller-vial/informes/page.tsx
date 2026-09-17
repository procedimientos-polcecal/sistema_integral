import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTallerVialDe } from "@/lib/tallerVial/auth";
import { traerCargas, traerEquiposTallerVial, traerEstadosDiarios } from "@/lib/tallerVial/consultas";
import { calcularTrabajoEntreCargas } from "@/lib/tallerVial/combustible";
import { resumenMensualDeEstados, type EstadoDiario } from "@/lib/tallerVial/estados";
import { armarInformeConsumo, armarInformeDisponibilidad } from "@/lib/tallerVial/informe";
import InformeClient from "./InformeClient";

/**
 * El informe mensual de Taller Vial — reemplaza los tabs "INFORME OCUPACIÓN
 * EQUIPOS MÓVILES — <MES> <AÑO>" de la planilla real ("SEGUIMIENTO EQUIPOS
 * MÓVILES"). No da los mismos números en todo: ver el comentario grande en
 * `lib/tallerVial/informe.ts` sobre qué se reemplaza por un cálculo propio y
 * qué queda afuera por depender de un dato que el SdG no tiene (régimen de
 * turnos, referencia histórica manual).
 */
export default async function InformesTallerVialPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTallerVialDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;

  const [equipos, todasLasCargas, todosLosEstados] = await Promise.all([
    traerEquiposTallerVial(supabase),
    traerCargas(supabase, {}),
    traerEstadosDiarios(supabase, {}),
  ]);

  const cargasConTrabajo = calcularTrabajoEntreCargas(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ id: c.id, equipoId: c.equipo_id!, fecha: c.fecha, litros: c.litros, lectura: c.lectura }))
  );
  const informeConsumo = armarInformeConsumo(cargasConTrabajo, mes);

  const estadosPlanos = todosLosEstados.map((e) => ({ equipoId: e.equipo_id, fecha: e.fecha, estado: e.estado as EstadoDiario }));
  const resumenEstados = resumenMensualDeEstados(estadosPlanos, mes);
  const informeDisponibilidad = armarInformeDisponibilidad(resumenEstados);

  return (
    <InformeClient
      mes={mes}
      equipos={equipos}
      informeConsumo={informeConsumo}
      informeDisponibilidad={informeDisponibilidad}
    />
  );
}
