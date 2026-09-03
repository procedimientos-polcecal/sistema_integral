import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import ArticulosClient from "./ArticulosClient";

export default async function ArticulosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  // De cuándo es lo que se está mirando. Va en todas las pantallas del
  // módulo porque el botón de traer también.
  const sync = await ultimaSincronizacionDe(supabase, "inventario", "articulos");

  return <ArticulosClient esAdmin={nivel === "admin"} sync={sync} />;
}
