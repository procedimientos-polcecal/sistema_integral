import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esAdminDelNucleo } from "@/lib/core/access";
import DuplicadosClient from "./DuplicadosClient";

/**
 * Los proveedores cargados dos veces, para fusionarlos.
 *
 * El cuadro lo trae `/api/compras/proveedores/duplicados` desde el cliente y
 * no esta página: son 19 lecturas más la planilla de Compras, entre cinco y
 * diez segundos. Server-side, eso es una pantalla en blanco sin explicación;
 * desde el cliente es un «buscando duplicados…» que dice qué está pasando.
 *
 * El permiso se comprueba en los dos lados a propósito: acá para no dibujar
 * una pantalla que no va a poder traer nada, y en las rutas porque son ellas
 * las que escriben.
 */
export default async function DuplicadosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!esAdminDelNucleo(usuario?.rol)) redirect("/compras/proveedores");

  return <DuplicadosClient />;
}
