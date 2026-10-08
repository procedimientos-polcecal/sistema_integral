import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import FichadasClient from "./FichadasClient";

export default async function FichadasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: empleados }, { data: fichadas }, ultimaSync] = await Promise.all([
    supabase.from("empleados").select("id, legajo, nombre, apellido").eq("activo", true).order("apellido").order("nombre"),
    supabase
      .from("fichadas")
      .select("id, fecha, hora_entrada, hora_salida, origen, empleados(legajo, nombre, apellido)")
      .order("fecha", { ascending: false })
      .limit(50),
    ultimaSincronizacionDe(supabase, "rrhh", "lenox-marcaciones"),
  ]);

  return <FichadasClient empleados={empleados ?? []} fichadasIniciales={fichadas ?? []} ultimaSync={ultimaSync} />;
}
