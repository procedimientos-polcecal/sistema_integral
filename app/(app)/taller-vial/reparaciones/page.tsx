import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTallerVialDe } from "@/lib/tallerVial/auth";
import { traerEquiposTallerVial, traerReparaciones } from "@/lib/tallerVial/consultas";
import ReparacionesClient from "./ReparacionesClient";

/**
 * El historial de reparaciones de los equipos móviles. Se carga desde acá —
 * no espeja ninguna planilla, a diferencia de las cargas de combustible y
 * los estados diarios.
 */
export default async function ReparacionesTallerVialPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTallerVialDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const [equipos, reparaciones] = await Promise.all([
    traerEquiposTallerVial(supabase),
    traerReparaciones(supabase),
  ]);

  return (
    <ReparacionesClient
      equipos={equipos}
      reparaciones={reparaciones}
      puedeEditar={permisos.puedeEditar}
    />
  );
}
