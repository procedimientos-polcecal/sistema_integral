import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { sectoresDePlanta, type SectorDePlanta } from "@/lib/mantenimiento/sectores";
import AvisosClient from "./AvisosClient";
import type { Aviso } from "@/lib/mantenimiento/types";
import type { EquipoDelAviso } from "./GenerarOTModal";

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

  // Los sectores y los equipos: desde el 21/10/2026 la OT que sale de un aviso
  // se puede corregir antes de crearla, y eso incluye a qué máquina es. Son 42
  // y 244, así que se traen enteros y la pantalla filtra sin volver al
  // servidor — un `fetch` por sector elegido sería un viaje por cada clic.
  const [sectores, equipos] = await Promise.all([
    sectoresDePlanta<SectorDePlanta>(supabase),
    traerTodo<EquipoDelAviso>((desde, hasta) =>
      supabase
        .from("equipos")
        .select("id, name, code, sector_id")
        .eq("is_active", true)
        .order("code")
        .range(desde, hasta)
    ),
  ]);

  // Esta pantalla espeja una planilla: cuándo se trajo es parte del dato.
  const sync = await ultimaSincronizacionDe(supabase, "mantenimiento", "avisos");

  return (
    <AvisosClient
      sync={sync}
      avisos={avisos}
      sectores={sectores}
      equipos={equipos}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
