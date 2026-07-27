import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import AdministracionClient from "./AdministracionClient";

export default async function AdministracionRrhhPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminRrhh(supabase, user.id))) redirect("/rrhh");

  return <AdministracionClient />;
}
