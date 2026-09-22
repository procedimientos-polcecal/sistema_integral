import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import EmpleadoDetalle from "./EmpleadoDetalle";
import { valorHoraDe } from "@/lib/rrhh/valorHora";

export default async function EmpleadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const canEdit = await esAdminRrhh(supabase, user.id);

  const [{ data: empleado }, { data: empresas }, { data: sectores }] = await Promise.all([
    supabase
      .from("empleados")
      .select("*, empresas(id, nombre), sectores(id, nombre), rrhh_empleados_datos(sindicato, valor_hora_normal)")
      .eq("id", id)
      .single(),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    // Sólo los activos, como en el listado: acá el desplegable los mostraba
    // todos, y son los que se le pueden asignar a alguien hoy.
    supabase.from("sectores").select("id, nombre").eq("activo", true).order("nombre"),
  ]);

  if (!empleado) notFound();

  // El valor hora dejo de ser columna de `empleados` (migracion 20260922101405).
  // Se aplana aca para que la pantalla lo siga leyendo como antes.
  const empleadoConValorHora = { ...empleado, valor_hora_normal: valorHoraDe(empleado) };

  return (
    <EmpleadoDetalle
      empleado={empleadoConValorHora}
      empresas={empresas ?? []}
      sectores={sectores ?? []}
      canEdit={canEdit}
    />
  );
}
