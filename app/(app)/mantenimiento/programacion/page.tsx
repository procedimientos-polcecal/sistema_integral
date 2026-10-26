import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import ProgramacionClient from "./ProgramacionClient";

/**
 * La programación semanal del taller. La usa una sola persona —el encargado— y
 * por eso la ve todo el que tenga admin de Mantenimiento y nadie más: las rutas
 * de `/api/mantenimiento/programacion` piden lo mismo, así que esta redirección
 * es cortesía y no la defensa.
 */
export default async function ProgramacionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminMantenimiento(supabase, user.id))) redirect("/mantenimiento");

  // Para sumar a alguien al padrón del taller. `empleados` es un catálogo del
  // núcleo con lectura abierta a cualquier autenticado: se lee, no se toca.
  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, nombre, apellido")
    .eq("activo", true)
    .order("apellido")
    .order("nombre");

  return <ProgramacionClient empleados={empleados ?? []} />;
}
