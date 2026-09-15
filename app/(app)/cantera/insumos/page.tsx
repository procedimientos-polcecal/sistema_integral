import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerInsumos } from "@/lib/cantera/consultas";
import InsumosClient from "./InsumosClient";

/**
 * El catálogo de insumos de voladura, con su precio USD vigente. De acá salen
 * los renglones de consumo de cada voladura, y el precio del catálogo se puede
 * pisar en el renglón. Sólo `admin`.
 */
export default async function InsumosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel !== "admin") redirect("/cantera/registros");

  return <InsumosClient insumos={await traerInsumos(supabase)} />;
}
