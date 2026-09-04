import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MisPedidosClient from "./MisPedidosClient";

/**
 * Fuera del módulo Compras a propósito: cualquier usuario del sistema puede
 * pedir un material, seguir los pedidos **de su área** y mirar los de los
 * demás.
 *
 * De su área y no los suyos: acá los requerimientos se piden por área, así que
 * los 950 RI de Mantenimiento los tienen que ver todos los de Mantenimiento.
 * Filtrar por quién los cargó dejaba la pantalla vacía —los 1.947 vinieron de
 * la planilla y ninguno trae solicitante— y además contestaba otra pregunta.
 *
 * Lo último no es un permiso nuevo: la 018 ya dejó `compras_requerimientos` con
 * lectura abierta a todo usuario autenticado, y lo dejó escrito con su razón —
 * "el circuito de compras es transversal a toda la empresa". Lo que faltaba era
 * una pantalla que lo aprovechara, para que dos personas no pidan lo mismo la
 * misma semana.
 *
 * Los pedidos los trae el cliente, no esta página: son 1.947 y mandarlos todos
 * al navegador para mostrar cincuenta es lo que hace que una pantalla tarde en
 * abrir. Acá quedan sólo los catálogos del formulario, que son chicos y se
 * necesitan enseguida para poder pedir.
 */
export default async function MisPedidosPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: areas }, { data: empresas }, { data: ubicaciones }, { data: mias }] =
    await Promise.all([
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
      // De qué áreas es esta persona. Acá se piden por área y no por nombre:
      // los RI de Mantenimiento los mira todo Mantenimiento, los haya cargado
      // quien los haya cargado.
      supabase.from("usuario_areas_compras").select("area_id").eq("usuario_id", user.id),
    ]);

  return (
    <MisPedidosClient
      usuarioId={user.id}
      misAreas={(mias ?? []).map((a) => a.area_id as string)}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
