import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MisPedidosClient from "./MisPedidosClient";

/**
 * Fuera del módulo Compras a propósito: cualquier usuario del sistema puede
 * pedir un material, seguir sus propios pedidos y **mirar los de los demás**.
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

  const [{ data: areas }, { data: empresas }, { data: ubicaciones }] = await Promise.all([
    supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
  ]);

  return (
    <MisPedidosClient
      usuarioId={user.id}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
