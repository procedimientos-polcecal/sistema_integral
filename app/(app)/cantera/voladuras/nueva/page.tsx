import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerYacimientos } from "@/lib/cantera/consultas";
import NuevaVoladuraClient from "./NuevaVoladuraClient";

/**
 * Dar de alta una voladura: se elige la cantera (y, si ya se sabe, la fecha de
 * voladura) y el sistema genera el código. Después se completa en el editor.
 */
export default async function NuevaVoladuraPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  const { y } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel === "lectura") redirect("/cantera/registros");

  const yacimientos = await traerYacimientos(supabase, true);
  return <NuevaVoladuraClient yacimientos={yacimientos} yacimientoPreseleccionado={y ?? ""} />;
}
