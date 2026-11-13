import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esAdminDelNucleo } from "@/lib/core/access";
import InfoTip from "@/components/InfoTip";

/**
 * La portada de la pestaña. No tenía chequeo: las dos pantallas que enlaza sí
 * redirigían, pero esta se abría escribiendo la URL y mostraba de qué se
 * administra el sistema a cualquiera con sesión. Los enlaces no son el permiso.
 */
export default async function AdministracionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!esAdminDelNucleo(usuario?.rol)) redirect("/");

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2"><h1 className="text-2xl font-bold text-slate-900">Administración</h1><InfoTip text="Es de quien administra el SdG: quién entra, a qué módulos y con qué nivel, las empresas y sectores que comparten todos los módulos, y si las sincronizaciones con las planillas están andando." /></div>
      <ul className="space-y-2">
        <li>
          <Link className="text-blue-700 hover:underline" href="/administracion/usuarios">
            Usuarios y permisos
          </Link>
        </li>
        <li>
          <Link className="text-blue-700 hover:underline" href="/administracion/empresas">
            Empresas y sectores
          </Link>
        </li>
        <li>
          <Link className="text-blue-700 hover:underline" href="/administracion/salud">
            Salud de las sincronizaciones
          </Link>
        </li>
      </ul>
    </div>
  );
}
