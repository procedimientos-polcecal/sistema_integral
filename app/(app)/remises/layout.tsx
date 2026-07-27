import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { NivelRemisesProvider } from "@/lib/remises/context";

export default async function RemisesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!usuario) redirect("/");

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", user.id);

  const nivel = nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "remises");
  if (!nivel) redirect("/");

  return (
    <NivelRemisesProvider nivel={nivel}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </NivelRemisesProvider>
  );
}
