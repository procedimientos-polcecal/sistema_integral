import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MiCuentaClient from "./MiCuentaClient";

const ROL_LABEL: Record<string, string> = {
  admin_sistema: "Admin sistema",
  admin: "Admin",
  encargado: "Encargado",
  operario: "Operario",
};

export default async function MiCuentaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("email, nombre, apellido, rol")
    .eq("id", user.id)
    .single();
  if (!usuario) redirect("/");

  return (
    <MiCuentaClient
      email={usuario.email}
      nombre={usuario.nombre}
      apellido={usuario.apellido}
      rolLabel={ROL_LABEL[usuario.rol] ?? usuario.rol}
    />
  );
}
