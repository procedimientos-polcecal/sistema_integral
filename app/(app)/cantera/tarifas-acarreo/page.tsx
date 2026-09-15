import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerTarifasAcarreo } from "@/lib/cantera/consultas";
import TarifasAcarreoClient from "./TarifasAcarreoClient";

/**
 * Las tarifas de acarreo por tipo y vigencia. Sólo `admin`: cambian el pago
 * de todos los fleteros de ese tipo hacia adelante.
 */
export default async function TarifasAcarreoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel !== "admin") redirect("/cantera/acarreo");

  return <TarifasAcarreoClient tarifas={await traerTarifasAcarreo(supabase)} />;
}
