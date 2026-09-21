import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerAcarreoDiario } from "@/lib/cantera/consultas";
import DiarioAcarreoClient from "./DiarioAcarreoClient";

/**
 * Cargar el acarreo de un día puntual — hoy sólo "viaje de bloques" importa
 * de verdad (es el acarreo real hacia Planta 2 de Trituración, que casi no
 * tiene pesada de balanza propia), pero se ofrecen los tres tipos sin
 * pesada por si hace falta después. No reemplaza el total mensual de
 * `/cantera/acarreo/cargar`, que sigue siendo lo que se usa para pagarle al
 * fletero — ver la migración 20260921091013.
 */
export default async function AcarreoDiarioPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { fecha: fechaParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel === "lectura") redirect("/cantera/acarreo");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request
  const hoy = new Date().toISOString().slice(0, 10);
  const fecha = fechaParam && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? fechaParam : hoy;

  const acarreosDelDia = await traerAcarreoDiario(supabase, { desde: fecha, hasta: fecha });

  return <DiarioAcarreoClient fecha={fecha} acarreos={acarreosDelDia} />;
}
