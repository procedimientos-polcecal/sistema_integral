import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerYacimientos } from "@/lib/cantera/consultas";
import YacimientosClient from "./YacimientosClient";

/**
 * El catálogo de canteras: código corto (el que va en el código de voladura),
 * material, densidad y la malla de diseño que prellena cada registro.
 *
 * Es la primera pantalla que hay que cargar: sin yacimientos no se puede dar de
 * alta una voladura. Sólo `admin` del módulo.
 */
export default async function YacimientosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel !== "admin") redirect("/cantera/registros");

  return <YacimientosClient yacimientos={await traerYacimientos(supabase)} />;
}
