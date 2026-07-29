import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import VacacionesClient from "./VacacionesClient";

export default async function VacacionesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, legajo, nombre, apellido")
    .eq("activo", true)
    .order("apellido")
    .order("nombre");

  return (
    <Suspense fallback={null}>
      <VacacionesClient empleados={empleados ?? []} />
    </Suspense>
  );
}
