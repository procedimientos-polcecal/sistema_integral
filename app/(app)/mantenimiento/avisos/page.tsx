import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  return (
    <AvisosClient
      avisos={avisos}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
