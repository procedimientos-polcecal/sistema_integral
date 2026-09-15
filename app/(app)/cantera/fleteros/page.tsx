import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerFleteros } from "@/lib/cantera/consultas";
import FleterosClient from "./FleterosClient";

/** El catálogo de fleteros de acarreo: nombre y patente. Sólo `admin`. */
export default async function FleterosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel !== "admin") redirect("/cantera/acarreo");

  return <FleterosClient fleteros={await traerFleteros(supabase)} />;
}
