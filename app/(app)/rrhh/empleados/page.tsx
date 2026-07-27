import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { puedeEditarRrhh } from "@/lib/rrhh/auth";
import EmpleadosClient from "./EmpleadosClient";

export default async function EmpleadosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const canEdit = await puedeEditarRrhh(supabase, user.id);

  const [{ data: empleados }, { data: empresas }, { data: sectores }] = await Promise.all([
    supabase
      .from("empleados")
      .select("id, legajo, nombre, apellido, fecha_ingreso, valor_hora_normal, horas_teoricas_diarias, activo, empresas(id, nombre), sectores(id, nombre), rrhh_empleados_datos(sindicato)")
      .order("apellido")
      .order("nombre"),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("sectores").select("id, nombre, activo").order("nombre"),
  ]);

  return (
    <EmpleadosClient
      empleados={empleados ?? []}
      empresas={empresas ?? []}
      sectores={sectores ?? []}
      canEdit={canEdit}
    />
  );
}
