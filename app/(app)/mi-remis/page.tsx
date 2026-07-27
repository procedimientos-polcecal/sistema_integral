import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MiRemisClient from "./MiRemisClient";

export default async function MiRemisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("nombre, empleado_id").eq("id", user.id).single();
  if (!usuario?.empleado_id) redirect("/");

  return <MiRemisClient nombre={usuario.nombre} />;
}
