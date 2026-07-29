import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import FeriadosClient from "./FeriadosClient";

export default async function FeriadosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminRrhh(supabase, user.id))) redirect("/rrhh");

  return <FeriadosClient />;
}
