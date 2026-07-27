import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import LiquidacionesClient from "./LiquidacionesClient";

export default async function LiquidacionesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminRrhh(supabase, user.id))) redirect("/rrhh");

  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, legajo, nombre, apellido")
    .eq("activo", true)
    .order("apellido")
    .order("nombre");

  return <LiquidacionesClient empleados={empleados ?? []} />;
}
