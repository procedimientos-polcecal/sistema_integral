import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerProductos } from "@/lib/calidad/ensayos/consultas";
import ProductosClient from "./ProductosClient";

/**
 * La lista de lo que se muestrea y el juego habitual de tamices de cada uno.
 *
 * Sólo `admin`: es configuración, igual que la RLS de la tabla. Las dos mitades
 * tienen que decir lo mismo — cuando no coincidieron, un admin veía los botones
 * y RLS le devolvía listas vacías.
 */
export default async function ProductosDeEnsayoPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (nivel !== "admin") redirect("/calidad/ensayos");

  const productos = await traerProductos(supabase);

  return <ProductosClient productos={productos} />;
}
