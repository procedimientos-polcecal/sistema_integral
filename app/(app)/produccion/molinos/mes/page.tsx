import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esMesValido, hoyEnArgentina } from "@/lib/core/fechas";
import { tieneAccesoProduccion } from "@/lib/produccion/auth";
import { mesDeMolino, traerMolinos, type MesDeMolino } from "@/lib/produccion/molinos/consultas";
import { nombreDelMolino } from "@/lib/produccion/molinos/formato";
import MesClient from "./MesClient";

export interface MolinoDelMes {
  id: string;
  /** "molino Filler 1": siempre acompañado (ver `nombreDelMolino`). */
  nombre: string;
  mes: MesDeMolino;
}

/**
 * Los cinco indicadores de cada molino en un mes, con los días no operativos
 * contados aparte. Mismo permiso y mismo motivo para el cliente admin que
 * `/produccion/molinos`.
 */
export default async function MolinosDelMesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: pedido } = await searchParams;
  const mes = esMesValido(pedido) ? pedido : hoyEnArgentina().slice(0, 7);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await tieneAccesoProduccion(supabase, user.id))) redirect("/");

  const admin = createAdminClient();
  const molinos = await traerMolinos(admin);
  const porMolino: MolinoDelMes[] = await Promise.all(
    molinos.map(async (m) => ({
      id: m.id,
      nombre: nombreDelMolino(m.nombre),
      mes: await mesDeMolino(admin, m.id, mes),
    })),
  );

  return <MesClient mes={mes} molinos={porMolino} />;
}
