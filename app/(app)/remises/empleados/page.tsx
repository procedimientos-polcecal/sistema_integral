import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import EmpleadosClient from "./EmpleadosClient";

export default async function RemisesEmpleadosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: empleados }, { data: turnos }] = await Promise.all([
    supabase
      .from("empleados")
      .select("id, legajo, nombre, apellido, domicilio, remises_empleados_datos(direccion, lat, lng, turno_default_id)")
      .eq("activo", true)
      .order("apellido")
      .order("nombre"),
    supabase.from("remises_turnos").select("id, nombre").order("nombre"),
  ]);

  return <EmpleadosClient empleados={empleados ?? []} turnos={turnos ?? []} />;
}
