import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import { NivelComprasProvider } from "@/lib/compras/context";
import { ConfirmProvider } from "@/components/ConfirmProvider";

export default async function ComprasLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("rol")
    .eq("id", user.id)
    .single();
  if (!usuario) redirect("/");

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", user.id);

  const nivel = nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "compras");
  // Sin acceso al módulo se va a /mis-pedidos, que sí es para cualquier usuario.
  if (!nivel) redirect("/mis-pedidos");

  return (
    <NivelComprasProvider nivel={nivel}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </NivelComprasProvider>
  );
}
