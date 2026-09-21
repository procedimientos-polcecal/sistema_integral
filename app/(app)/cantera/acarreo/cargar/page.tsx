import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerAcarreos, traerFleteros } from "@/lib/cantera/consultas";
import CargarAcarreoClient from "./CargarAcarreoClient";

/**
 * Cargar el acarreo de un fletero, día por día: los 5 tipos sin pesada, con
 * la cantidad que ya esté cargada ese día. El usuario pidió poder
 * asignarle fecha a cada uno (antes era un total por mes, sin desglose) —
 * ver la migración 20260921092307. El mes elegido sale de la fecha.
 */
export default async function CargarAcarreoPage({
  searchParams,
}: {
  searchParams: Promise<{ fletero?: string; fecha?: string }>;
}) {
  const { fletero: fleteroParam, fecha: fechaParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel === "lectura") redirect("/cantera/acarreo");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request
  const hoy = new Date().toISOString().slice(0, 10);
  const fecha = fechaParam && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? fechaParam : hoy;
  const mes = fecha.slice(0, 7);

  const fleteros = await traerFleteros(supabase, true);
  const fleteroId = fleteros.some((f) => f.id === fleteroParam) ? fleteroParam! : (fleteros[0]?.id ?? "");

  const acarreosDelMes = fleteroId ? await traerAcarreos(supabase, { fleteroId, mes }) : [];

  return <CargarAcarreoClient fleteros={fleteros} fleteroId={fleteroId} fecha={fecha} acarreosDelMes={acarreosDelMes} />;
}
