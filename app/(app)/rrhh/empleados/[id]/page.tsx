import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import EmpleadoDetalle from "./EmpleadoDetalle";

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
      .select("*, empresas(id, nombre), sectores(id, nombre), rrhh_empleados_datos(sindicato)")
      .eq("id", id)
      .single(),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("sectores").select("id, nombre").order("nombre"),
  ]);

  if (!empleado) notFound();

  return (
    <EmpleadoDetalle
      empleado={empleado}
      empresas={empresas ?? []}
      sectores={sectores ?? []}
      canEdit={canEdit}
    />
  );
}
