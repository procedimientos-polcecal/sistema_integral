import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esAdminProduccion } from "@/lib/produccion/auth";
import { traerProductos } from "@/lib/produccion/consultas";
import ProductosClient from "./ProductosClient";

export default async function ProductosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Sólo el admin del módulo da de alta y edita el catálogo. Quien tiene
  // lectura o edición lo consume (la carga del parte y los resúmenes lo leen
  // por su cuenta), pero no lo administra.
  if (!(await esAdminProduccion(supabase, user.id))) redirect("/produccion");

  // Completo y no `soloActivos`: acá se administra también lo desactivado —
  // es donde se lo vuelve a activar.
  const productos = await traerProductos(supabase, { soloActivos: false });

  return <ProductosClient productosIniciales={productos} />;
}
