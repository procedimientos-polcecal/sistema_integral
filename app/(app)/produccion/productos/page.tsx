import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esAdminProduccion } from "@/lib/produccion/auth";
import { traerRenglonesDePapel } from "@/lib/produccion/consultas";
import { traerCatalogoDeProductos } from "@/lib/core/productos";
import RenglonesClient from "./ProductosClient";

/**
 * Los renglones del parte en papel, y qué productos cuenta cada uno.
 *
 * Son dos cosas distintas y por eso están juntas en una pantalla: el renglón es
 * cómo se ve el papel —su nombre, su familia, su columna en el Excel— y el
 * producto es la cosa física, que vive en el catálogo del núcleo y comparte con
 * Despacho.
 *
 * La correspondencia entre los dos **no está escrita en ningún lado**: vive en
 * la cabeza de quien carga hoy el Excel, y es lo que este spec deja registrar
 * (docs/superpowers/specs/2026-09-10-productos-catalogo-unico-design.md). Un
 * renglón puede enlazar varios productos: si el papel cuenta "cal en bolsón" en
 * un solo renglón, ahí caen las tres variantes de Odoo que se despachan.
 */
export default async function RenglonesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Sólo el admin del módulo edita esto. Quien tiene lectura o edición lo
  // consume (la carga del parte y los resúmenes lo leen por su cuenta), pero no
  // lo administra.
  if (!(await esAdminProduccion(supabase, user.id))) redirect("/produccion");

  // Completos y no `soloActivos`: acá se administra también lo desactivado —
  // es donde se lo vuelve a activar.
  const [renglones, catalogo, enlaces] = await Promise.all([
    traerRenglonesDePapel(supabase, { soloActivos: false }),
    traerCatalogoDeProductos(supabase),
    supabase.from("produccion_renglon_productos").select("renglon_papel_id, producto_id"),
  ]);

  const porRenglon: Record<string, string[]> = {};
  for (const e of (enlaces.data ?? []) as { renglon_papel_id: string; producto_id: string }[]) {
    (porRenglon[e.renglon_papel_id] ??= []).push(e.producto_id);
  }

  return (
    <RenglonesClient
      renglonesIniciales={renglones}
      catalogo={catalogo}
      enlacesIniciales={porRenglon}
    />
  );
}
