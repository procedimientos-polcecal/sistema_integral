import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerAcarreos, traerFleteros } from "@/lib/cantera/consultas";
import CargarAcarreoClient from "./CargarAcarreoClient";

/**
 * Cargar el acarreo de un fletero en un mes: los 19 tipos, con la cantidad
 * que ya esté cargada. El mismo nivel que la pestaña "Ingreso de Datos" de
 * la planilla de balanza — un total por tipo, no cada viaje.
 */
export default async function CargarAcarreoPage({
  searchParams,
}: {
  searchParams: Promise<{ fletero?: string; mes?: string }>;
}) {
  const { fletero: fleteroParam, mes: mesParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel === "lectura") redirect("/cantera/acarreo");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request
  const mesActual = new Date().toISOString().slice(0, 7);
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;

  const fleteros = await traerFleteros(supabase, true);
  const fleteroId = fleteros.some((f) => f.id === fleteroParam) ? fleteroParam! : (fleteros[0]?.id ?? "");

  const acarreos = fleteroId ? await traerAcarreos(supabase, { fleteroId, mes }) : [];

  return <CargarAcarreoClient fleteros={fleteros} fleteroId={fleteroId} mes={mes} acarreos={acarreos} />;
}
