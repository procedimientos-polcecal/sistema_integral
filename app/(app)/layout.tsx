import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { modulosVisibles } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, apellido, rol, empleado_id")
    .eq("id", user.id)
    .single();

  // Usuario autenticado en Supabase pero sin fila en `usuarios`: sin acceso.
  if (!usuario) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold">Tu cuenta todavía no fue habilitada.</p>
          <p className="text-sm text-gray-500">Pedile a un administrador que te dé acceso.</p>
        </div>
      </main>
    );
  }

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", user.id);

  const rol = usuario.rol as Rol;
  const modulos = modulosVisibles(rol, (grants ?? []) as UsuarioModulo[]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        modulos={modulos}
        rol={rol}
        usuarioNombre={`${usuario.nombre} ${usuario.apellido}`.trim()}
        esEmpleadoRemises={!!usuario.empleado_id}
      />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
