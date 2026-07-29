import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import EmpresasSectoresManager from "@/components/administracion/EmpresasSectoresManager";

export default async function EmpresasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  const esAdmin = usuario?.rol === "admin_sistema" || usuario?.rol === "admin";
  if (!esAdmin) redirect("/");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Empresas y sectores</h1>
      <EmpresasSectoresManager />
    </div>
  );
}
