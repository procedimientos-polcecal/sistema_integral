import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import HistorialClient from "./HistorialClient";

/**
 * Todo el trabajo que se registró, venga de donde venga.
 *
 * Una ejecución cuelga de un mantenimiento programado **o** de una orden de
 * trabajo. Traer sólo las primeras dejaba afuera todo lo que se registra al
 * cerrar una OT, que es por donde entra la mayor parte del trabajo de la
 * planta.
 */
export default async function HistorialPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: executions } = await supabase
    .from("mantenimientos_ejecuciones")
    .select(`
      *,
      schedule:schedule_id(
        maintenance_type,
        schedule_type,
        equipos(name, code, sectores(nombre, empresas(nombre)))
      ),
      orden:work_order_id(ot_number, descripcion, tipo, especialidad),
      equipo:equipment_id(name, code, sectores(nombre, empresas(nombre))),
      executor:executed_by(nombre, apellido)
    `)
    .order("executed_at", { ascending: false })
    .limit(200);

  return <HistorialClient executions={executions ?? []} />;
}
