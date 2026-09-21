import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerTarifasDestape } from "@/lib/cantera/consultas";
import TarifasDestapeClient from "./TarifasDestapeClient";

/**
 * La tarifa de destape ($/h) que sigue siendo tarifa: fletero externo por
 * tipo de camión. Máquina propia (Odoo + combustible / horas de uso) y
 * mano de obra propia (`empleados.valor_hora_normal` del operario) se
 * calculan, no se cargan acá. Sólo `admin`: cambia el costo de todo
 * destape hacia adelante.
 */
export default async function TarifasDestapePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel !== "admin") redirect("/cantera/destape");

  const tarifas = await traerTarifasDestape(supabase);

  return <TarifasDestapeClient tarifas={tarifas} />;
}
