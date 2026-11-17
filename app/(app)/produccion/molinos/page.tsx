import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esFechaIso, hoyEnArgentina } from "@/lib/core/fechas";
import { tieneAccesoProduccion } from "@/lib/produccion/auth";
import { diaDeMolino, traerMolinos, type DiaDeMolino } from "@/lib/produccion/molinos/consultas";
import { nombreDelMolino } from "@/lib/produccion/molinos/formato";
import MolinosClient from "./MolinosClient";

export interface MolinoDelDia {
  id: string;
  /** "molino Filler 1": siempre acompañado (ver `nombreDelMolino`). */
  nombre: string;
  dia: DiaDeMolino;
}

/**
 * Lo que midió el PC Robot en cada molino un día: los cuatro turnos con sus
 * toneladas, su marcha y su parada.
 *
 * Esto **no es el parte de Producción** (`/produccion/dia`): el parte cuenta
 * producto terminado y esto cuenta lo que se muele, así que no se suman.
 *
 * Usa el cliente admin —las consultas de los molinos lo piden—, y por eso el
 * permiso se comprueba acá, arriba de todo: ahí RLS no corre.
 */
export default async function MolinosDelDiaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { fecha: pedida } = await searchParams;
  const fecha = esFechaIso(pedida) ? pedida : hoyEnArgentina();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await tieneAccesoProduccion(supabase, user.id))) redirect("/");

  const admin = createAdminClient();
  const molinos = await traerMolinos(admin);
  const porMolino: MolinoDelDia[] = await Promise.all(
    molinos.map(async (m) => ({
      id: m.id,
      nombre: nombreDelMolino(m.nombre),
      dia: await diaDeMolino(admin, m.id, fecha),
    })),
  );

  return <MolinosClient fecha={fecha} molinos={porMolino} />;
}
