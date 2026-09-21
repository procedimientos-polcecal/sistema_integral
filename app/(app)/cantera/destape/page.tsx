import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerCapacidadesFletero, traerDestape, traerTarifasDestape } from "@/lib/cantera/consultas";
import { traerEquiposTallerVial } from "@/lib/tallerVial/consultas";
import DestapeClient from "./DestapeClient";

/**
 * El tablero de destape del mes: cuántas horas y cuánto costó, por
 * yacimiento — "Resumen → Por yacimiento" de la planilla real. Por defecto
 * el mes en curso.
 */
export default async function DestapePage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;
  const [anio, mesNum] = mes.split("-").map(Number);
  const primerDia = `${mes}-01`;
  const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);

  const [registrosDelMes, tarifas, capacidades, equipos] = await Promise.all([
    traerDestape(supabase, { desde: primerDia, hasta: ultimoDia }),
    traerTarifasDestape(supabase),
    traerCapacidadesFletero(supabase),
    traerEquiposTallerVial(supabase),
  ]);
  const codigoPorEquipoId = Object.fromEntries(equipos.map((e) => [e.id, e.code]));

  return (
    <DestapeClient
      mes={mes}
      registros={registrosDelMes}
      tarifas={tarifas}
      capacidades={capacidades}
      codigoPorEquipoId={codigoPorEquipoId}
      puedeEditar={permisos.puedeEditar}
      esAdmin={permisos.esAdmin}
    />
  );
}
