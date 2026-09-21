import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerTarifasDestape } from "@/lib/cantera/consultas";
import { traerEquiposTallerVial } from "@/lib/tallerVial/consultas";
import TarifasDestapeClient from "./TarifasDestapeClient";

/**
 * Las 3 tarifas de destape ($/h): máquina propia por equipo, mano de obra
 * propia y fletero externo por tipo de camión. Sólo `admin`: cambian el
 * costo de todo destape hacia adelante. Reusa `traerEquiposTallerVial`
 * (mismos EM2-EM9 de Mantenimiento) para no duplicar el catálogo.
 */
export default async function TarifasDestapePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel !== "admin") redirect("/cantera/destape");

  const [tarifas, equipos] = await Promise.all([
    traerTarifasDestape(supabase),
    traerEquiposTallerVial(supabase),
  ]);

  return <TarifasDestapeClient tarifas={tarifas} equipos={equipos} />;
}
