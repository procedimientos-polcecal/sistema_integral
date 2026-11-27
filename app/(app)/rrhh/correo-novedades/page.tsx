import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import CorreoNovedadesClient from "./CorreoNovedadesClient";

/**
 * Mandar el correo de novedades eligiendo a quién.
 *
 * Pide admin de RR.HH. por lo que el correo lleva adentro —las observaciones
 * de una ausencia y quién la cargó—, que es el mismo motivo por el que la ruta
 * lo pide del otro lado. Acá se redirige y allá se contesta 403: la pantalla
 * no es la defensa.
 */
export default async function CorreoNovedadesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminRrhh(supabase, user.id))) redirect("/rrhh");

  return <CorreoNovedadesClient />;
}
