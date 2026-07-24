import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe, usuariosConAccesoMantenimiento } from "@/lib/mantenimiento/auth";
import MantenimientosClient from "./MantenimientosClient";

export default async function MantenimientosPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schedules }, { data: equipos }, users, { data: linkedOts }] = await Promise.all([
    supabase
      .from("mantenimientos_programados")
      .select("*, equipos(id, name, code, sector_id, sectores(nombre, empresas(nombre))), assigned_user:assigned_to(nombre, apellido)")
      .order("next_date", { ascending: true }),
    supabase
      .from("equipos")
      .select("id, name, code, sector_id, sectores(nombre, empresas(nombre))")
      .eq("is_active", true)
      .order("code"),
    usuariosConAccesoMantenimiento(supabase),
    supabase
      .from("ordenes_trabajo")
      .select("id, ot_number, estado, descripcion, schedule_id")
      .not("schedule_id", "is", null)
      .order("ot_number", { ascending: false }),
  ]);

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  return (
    <MantenimientosClient
      schedules={schedules ?? []}
      equipos={equipos ?? []}
      users={users}
      linkedOts={linkedOts ?? []}
      canEdit={canEdit}
    />
  );
}
