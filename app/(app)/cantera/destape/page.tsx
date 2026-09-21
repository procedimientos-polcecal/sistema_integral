import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerAcarreos, traerCapacidadesFletero, traerDestape, traerFleteros, traerTarifasDestape } from "@/lib/cantera/consultas";
import { traerEquiposTallerVial } from "@/lib/tallerVial/consultas";
import DestapeClient from "./DestapeClient";

/**
 * El tablero de destape del mes: cuántas horas y cuánto costó, por
 * yacimiento — "Resumen → Por yacimiento" de la planilla real. Por defecto
 * el mes en curso.
 *
 * También trae, por fletero, las horas "horas_destape" que ya estén
 * cargadas en Acarreo (`cantera_acarreos`) — el usuario pidió que quede
 * vinculado. No se suma al costo de Destape ni se mezcla con
 * `cantera_destape`: Acarreo sigue siendo donde se carga y de donde sale
 * el pago (su propia tarifa "horas_destape", vigente desde antes de este
 * módulo); acá es sólo una referencia cruzada para no cargar por partida
 * doble sin darse cuenta — mismo patrón que ya usa Trituración con
 * "viaje_de_bloques" (lib/trituracion/cruceCantera.ts).
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

  const [registrosDelMes, tarifas, capacidades, equipos, horasDestapeAcarreo, fleteros] = await Promise.all([
    traerDestape(supabase, { desde: primerDia, hasta: ultimoDia }),
    traerTarifasDestape(supabase),
    traerCapacidadesFletero(supabase),
    traerEquiposTallerVial(supabase),
    traerAcarreos(supabase, { tipo: "horas_destape", mes }),
    traerFleteros(supabase),
  ]);
  const codigoPorEquipoId = Object.fromEntries(equipos.map((e) => [e.id, e.code]));
  const nombrePorFleteroId = Object.fromEntries(fleteros.map((f) => [f.id, f.nombre]));

  const horasDestapeAcarreoPorFletero = horasDestapeAcarreo
    .map((a) => ({ fletero: nombrePorFleteroId[a.fletero_id] ?? "(fletero desconocido)", horas: a.cantidad, fecha: a.fecha }))
    .sort((a, b) => a.fletero.localeCompare(b.fletero));

  return (
    <DestapeClient
      mes={mes}
      registros={registrosDelMes}
      tarifas={tarifas}
      capacidades={capacidades}
      codigoPorEquipoId={codigoPorEquipoId}
      horasDestapeAcarreo={horasDestapeAcarreoPorFletero}
      puedeEditar={permisos.puedeEditar}
      esAdmin={permisos.esAdmin}
    />
  );
}
