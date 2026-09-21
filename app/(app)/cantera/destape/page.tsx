import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerAcarreos, traerDestape, traerFleteros, traerOperariosDeCantera, traerPesadas, traerTarifasDestape } from "@/lib/cantera/consultas";
import { toneladasPromedioPorFletero } from "@/lib/cantera/destape";
import { costoHoraDeMaquinasDelMes } from "@/lib/cantera/costoMaquinaOdoo";
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
 *
 * A pedido del usuario (21/09/2026), dos de las tres fuentes de costo ya
 * no son una tarifa cargada a mano:
 * - **Toneladas del fletero**: en vez de "capacidad" (se sacó del todo, no
 *   había forma de relevarla), se usa el promedio real de lo que ese
 *   fletero transportó en Acarreo (`lib/cantera/destape.ts`).
 * - **Máquina propia**: se calcula con Odoo y Taller Vial
 *   (`lib/cantera/costoMaquinaOdoo.ts`) — sólo para los equipos que
 *   aparecen en los registros de este mes, no toda la flota.
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

  const [registrosDelMes, tarifas, equipos, horasDestapeAcarreo, fleteros, pesadas, operarios] = await Promise.all([
    traerDestape(supabase, { desde: primerDia, hasta: ultimoDia }),
    traerTarifasDestape(supabase),
    traerEquiposTallerVial(supabase),
    traerAcarreos(supabase, { tipo: "horas_destape", mes }),
    traerFleteros(supabase),
    traerPesadas(supabase),
    traerOperariosDeCantera(supabase),
  ]);
  const codigoPorEquipoId = Object.fromEntries(equipos.map((e) => [e.id, e.code]));
  const nombrePorFleteroId = Object.fromEntries(fleteros.map((f) => [f.id, f.nombre]));
  const valorHoraPorOperarioId = Object.fromEntries(operarios.map((o) => [o.id, o.valorHoraNormal]));

  const toneladasPromedio = toneladasPromedioPorFletero(pesadas.map((p) => ({ fleteroId: p.fletero_id, toneladas: p.toneladas })));

  const codigosDeEquipoDelMes = [...new Set(
    registrosDelMes
      .filter((r) => r.tipo_recurso === "operario_propio" && r.equipo_id)
      .map((r) => codigoPorEquipoId[r.equipo_id as string])
      .filter((c): c is string => Boolean(c))
  )];
  const costoHoraPorEquipo: Record<string, number> = {};
  const costos = await costoHoraDeMaquinasDelMes(supabase, codigosDeEquipoDelMes, mes);
  for (const [codigo, c] of Object.entries(costos)) {
    if (c.costoHora !== null) costoHoraPorEquipo[codigo] = c.costoHora;
  }

  const horasDestapeAcarreoPorFletero = horasDestapeAcarreo
    .map((a) => ({ fletero: nombrePorFleteroId[a.fletero_id] ?? "(fletero desconocido)", horas: a.cantidad, fecha: a.fecha }))
    .sort((a, b) => a.fletero.localeCompare(b.fletero));

  return (
    <DestapeClient
      mes={mes}
      registros={registrosDelMes}
      tarifas={tarifas}
      toneladasPromedioPorFletero={toneladasPromedio}
      costoHoraPorEquipo={costoHoraPorEquipo}
      codigoPorEquipoId={codigoPorEquipoId}
      valorHoraPorOperarioId={valorHoraPorOperarioId}
      horasDestapeAcarreo={horasDestapeAcarreoPorFletero}
      puedeEditar={permisos.puedeEditar}
      esAdmin={permisos.esAdmin}
    />
  );
}
