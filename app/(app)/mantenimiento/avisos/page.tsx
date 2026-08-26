import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import AvisosClient from "./AvisosClient";
import type { Aviso } from "@/lib/mantenimiento/types";

export default async function AvisosPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const avisos = await traerTodo<Aviso>((desde, hasta) =>
    supabase
      .from("avisos")
      .select("*, equipos(name, code), sectores(nombre)")
      .order("fecha", { ascending: false, nullsFirst: false })
      .range(desde, hasta)
  );

  // Esta pantalla espeja una planilla: cuándo se trajo es parte del dato.
  const sync = await ultimaSincronizacionDe(supabase, "mantenimiento", "avisos");

  return (
    <AvisosClient
      sync={sync}
      avisos={avisos}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
