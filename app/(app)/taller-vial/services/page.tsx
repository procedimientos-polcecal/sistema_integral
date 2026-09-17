import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTallerVialDe } from "@/lib/tallerVial/auth";
import { traerCargas, traerEquiposTallerVial, traerServices } from "@/lib/tallerVial/consultas";
import { resumenServicePorEquipo, ultimaLecturaPorEquipo } from "@/lib/tallerVial/service";
import ServicesClient from "./ServicesClient";

/**
 * Los cuatro escalones de service (250/500/1000/2000 hs) de cada equipo, en
 * cascada. A diferencia del resto de Taller Vial, esto se carga desde acá —
 * la planilla real no tiene un registro cargable de cada intervención.
 *
 * El horómetro "actual" contra el que se mide cuánto falta sale de la
 * lectura más reciente de `taller_vial_cargas` (combustible), no de un campo
 * propio: dos horómetros del mismo equipo se podrían desincronizar sin que
 * nada avise.
 */
export default async function ServicesTallerVialPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTallerVialDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const [equipos, todasLasCargas, todosLosServices] = await Promise.all([
    traerEquiposTallerVial(supabase),
    traerCargas(supabase, {}),
    traerServices(supabase),
  ]);

  const horometroActualPorEquipo = ultimaLecturaPorEquipo(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ equipoId: c.equipo_id!, fecha: c.fecha, lectura: c.lectura }))
  );

  const porEquipo = resumenServicePorEquipo(
    equipos.map((e) => e.id),
    todosLosServices.map((s) => ({ id: s.id, equipoId: s.equipo_id, tier: s.tier, fecha: s.fecha, horometro: s.horometro })),
    horometroActualPorEquipo
  );
  const estadoPorEquipo = equipos.map((eq) => {
    const r = porEquipo.find((p) => p.equipoId === eq.id)!;
    return { equipo: eq, horometroActual: r.horometroActual, escalones: r.escalones };
  });

  const historial = [...todosLosServices]
    .sort((a, b) => (a.fecha === b.fecha ? 0 : a.fecha < b.fecha ? 1 : -1))
    .slice(0, 30);

  return (
    <ServicesClient
      equipos={equipos}
      estadoPorEquipo={estadoPorEquipo}
      historial={historial}
      puedeEditar={permisos.puedeEditar}
    />
  );
}
