import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import type { OrdenServicio } from "@/lib/mantenimiento/types";
import OrdenesServicioClient from "./OrdenesServicioClient";

/**
 * Las órdenes de servicio: los trabajos que se le piden a un tercero.
 *
 * Se traen todas de una —son cientos, no cientos de miles— para poder filtrar
 * y buscar en la pantalla sin volver al servidor en cada tecla.
 */
export default async function OrdenesServicioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const puedeEditar = nivel === "edicion" || nivel === "admin";

  const [ordenes, { data: sectores }] = await Promise.all([
    traerTodo<OrdenServicio>((desde, hasta) =>
      supabase
        .from("ordenes_servicio")
        .select("*, equipos(name, code), sectores(nombre)")
        .order("os_number", { ascending: false })
        .range(desde, hasta)
    ),
    supabase.from("sectores").select("id, nombre").order("nombre"),
  ]);

  // Cuántas cotizaciones tiene cada OS, para no abrir una comparativa vacía.
  const cotizaciones = await traerTodo<{ os_number: number | null }>((desde, hasta) =>
    supabase.from("os_comparativas").select("os_number").range(desde, hasta)
  );

  const cotizacionesPorOS: Record<number, number> = {};
  for (const c of cotizaciones) {
    if (c.os_number) cotizacionesPorOS[c.os_number] = (cotizacionesPorOS[c.os_number] ?? 0) + 1;
  }

  return (
    <OrdenesServicioClient
      puedeEditar={puedeEditar}
      ordenes={ordenes}
      sectores={sectores ?? []}
      cotizacionesPorOS={cotizacionesPorOS}
    />
  );
}
