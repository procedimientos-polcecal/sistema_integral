import { redirect } from "next/navigation";
import { logout } from "@/app/login/actions";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { NavMovilProvider } from "@/components/NavMovil";
import { modulosVisibles, nivelEnModulo, MODULOS_ORDEN } from "@/lib/core/access";
import { puedeAprobarCompras, puedeAprobarOS } from "@/lib/compras/auth";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, apellido, rol, empleado_id, activo")
    .eq("id", user.id)
    .single();

  // Sin fila en `usuarios`, o dado de baja: no entra.
  //
  // Se muestra en el lugar y no con redirect: el middleware manda a "/" a
  // cualquiera con sesión válida, así que redirigir a /login haría un bucle.
  // El botón cierra la sesión, que es la única salida real.
  if (!usuario || !usuario.activo) {
    const desactivado = Boolean(usuario) && !usuario?.activo;
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-lg font-semibold">
            {desactivado ? "Tu cuenta está desactivada." : "Tu cuenta todavía no fue habilitada."}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {desactivado
              ? "Un administrador dio de baja tu acceso. Si creés que es un error, avisale."
              : "Pedile a un administrador que te dé acceso."}
          </p>
          <form action={logout}>
            <button
              type="submit"
              className="mt-5 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </main>
    );
  }

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", user.id);

  const rol = usuario.rol as Rol;
  const grantsList = (grants ?? []) as UsuarioModulo[];
  const modulos = modulosVisibles(rol, grantsList);
  const modulosAdmin = MODULOS_ORDEN.filter((m) => nivelEnModulo(rol, grantsList, m) === "admin");

  // Aprobar no depende del nivel: sale de una lista. Son dos, y en paralelo
  // porque no dependen entre sí: los requerimientos los aprueba una y las
  // órdenes de servicio la otra.
  const [esAprobadorCompras, esAprobadorOS] = await Promise.all([
    puedeAprobarCompras(supabase, user.id),
    puedeAprobarOS(supabase, user.id),
  ]);

  return (
    <NavMovilProvider>
      <div className="flex h-screen flex-col">
        <Header usuarioNombre={`${usuario.nombre} ${usuario.apellido}`.trim()} />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            modulos={modulos}
            modulosAdmin={modulosAdmin}
            rol={rol}
            esAprobadorCompras={esAprobadorCompras}
            esAprobadorOS={esAprobadorOS}
            esEmpleadoRemises={!!usuario.empleado_id}
          />
          {/* En un teléfono cada píxel de ancho cuenta: 24 de padding por lado
              eran 48 de los 375 que hay. `min-w-0` es lo que deja que las
              tablas scrolleen adentro en vez de estirar la página entera. */}
          <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </NavMovilProvider>
  );
}
