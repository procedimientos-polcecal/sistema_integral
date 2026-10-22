import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { areaPorDefecto } from "@/lib/compras/areaDelUsuario";
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
  // Lo que el alta de un aviso necesita saber de quien tiene la sesión: cómo se
  // llama, para precargar «Quién avisa», y de qué áreas es, para arrancar con la
  // suya. Se lee con la sesión, igual que «Mis pedidos»: las tres tablas dejan a
  // un usuario leer lo suyo.
  const [{ data: areas }, { data: misAreas }, { data: yo }] = await Promise.all([
    supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("usuario_areas_compras").select("area_id").eq("usuario_id", user.id),
    supabase.from("usuarios").select("nombre, apellido").eq("id", user.id).single(),
  ]);

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
      areas={areas ?? []}
      // Con cero o dos áreas queda vacío y el modal pide elegir: no se adivina.
      areaInicial={areaPorDefecto((misAreas ?? []).map((a) => a.area_id as string))}
      quienAviso={yo ? `${yo.nombre} ${yo.apellido}`.trim() : ""}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
