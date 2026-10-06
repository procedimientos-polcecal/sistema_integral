import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerLimites, traerProductos } from "@/lib/calidad/ensayos/consultas";
import LimitesClient from "./LimitesClient";

/** Los límites por producto. Sólo `admin`, como la RLS de la tabla. */
export default async function LimitesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (nivel !== "admin") redirect("/calidad/ensayos");

  const [productos, limites] = await Promise.all([
    traerProductos(supabase),
    traerLimites(supabase),
  ]);

  return <LimitesClient productos={productos} limites={limites} />;
}
