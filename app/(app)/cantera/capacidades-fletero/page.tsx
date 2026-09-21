import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerCapacidadesFletero, traerFleteros } from "@/lib/cantera/consultas";
import CapacidadesFleteroClient from "./CapacidadesFleteroClient";

/** Toneladas por viaje, por fletero y tipo de camión — pestaña "Capacidades" de destape. Sólo `admin`. */
export default async function CapacidadesFleteroPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel !== "admin") redirect("/cantera/destape");

  const [fleteros, capacidades] = await Promise.all([
    traerFleteros(supabase, true),
    traerCapacidadesFletero(supabase),
  ]);

  return <CapacidadesFleteroClient fleteros={fleteros} capacidades={capacidades} />;
}
