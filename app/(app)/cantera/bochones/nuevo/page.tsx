import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerYacimientos } from "@/lib/cantera/consultas";
import NuevoBochonClient from "./NuevoBochonClient";

/** Dar de alta un bochón: cantera + fecha de voladura → el sistema genera el código. */
export default async function NuevoBochonPage({
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
  if (nivel === "lectura") redirect("/cantera");

  const yacimientos = await traerYacimientos(supabase, true);
  return <NuevoBochonClient yacimientos={yacimientos} yacimientoPreseleccionado={y ?? ""} />;
}
