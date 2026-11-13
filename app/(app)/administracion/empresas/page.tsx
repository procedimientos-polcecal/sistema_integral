import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminDelNucleo } from "@/lib/core/access";
import EmpresasSectoresManager from "@/components/administracion/EmpresasSectoresManager";
import InfoTip from "@/components/InfoTip";

export default async function EmpresasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!esAdminDelNucleo(usuario?.rol)) redirect("/");

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-bold text-slate-900">Empresas y sectores</h1>
        <InfoTip text="El catálogo de empresas y sectores que comparten los módulos: de acá salen los desplegables de sector de Inventario, RRHH y Mantenimiento, entre otros. Sólo entra quien tiene el rol «Admin sistema»; quien administra un módulo, no. Las empresas son POLCECAL y POLYSAN y no se pueden crear más; los sectores organizativos sí." />
      </div>
      <EmpresasSectoresManager />
    </div>
  );
}
