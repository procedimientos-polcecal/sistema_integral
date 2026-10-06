import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import {
  traerAcarreoIdsClasificadosEnDestape, traerAcarreos, traerDestape, traerFleteros, traerOperariosDeCantera,
  traerYacimientos,
} from "@/lib/cantera/consultas";
import { horasDeAcarreoSinClasificar } from "@/lib/cantera/destape";
import { traerEquiposTallerVial } from "@/lib/tallerVial/consultas";
import CargarDestapeClient from "./CargarDestapeClient";

/**
 * Cargar un recurso de destape (máquina propia + operario, o fletero +
 * camión) para un día, y editar/borrar lo ya cargado.
 *
 * La lista de abajo era "últimos 7 días" fijo; a pedido del usuario (quiere
 * poder editar registros más viejos) ahora es por mes, navegable igual que
 * el resto del módulo — por defecto el mes en curso, que ya cubre el caso
 * de "lo que acabo de cargar".
 */
export default async function CargarDestapePage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel === "lectura") redirect("/cantera/destape");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request
  const hoy = new Date().toISOString().slice(0, 10);
  const mesActual = hoy.slice(0, 7);
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;
  const [anio, mesNum] = mes.split("-").map(Number);
  const primerDia = `${mes}-01`;
  const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);

  // Ventana más ancha para las horas de Acarreo sin clasificar: puede
  // quedar una carga sin elegir yacimiento varios días, y acá es donde se
  // la va a buscar para completarla — independiente del mes que se esté
  // mirando en la lista de abajo.
  const desdeAcarreo = new Date(new Date(hoy).getTime() - 60 * 86400000).toISOString().slice(0, 10);

  const [yacimientos, fleteros, operarios, equipos, registrosDelMes, acarreosHorasDestape, acarreoIdsClasificados] = await Promise.all([
    traerYacimientos(supabase, true),
    traerFleteros(supabase, true),
    traerOperariosDeCantera(supabase),
    traerEquiposTallerVial(supabase),
    traerDestape(supabase, { desde: primerDia, hasta: ultimoDia }),
    traerAcarreos(supabase, { tipo: "horas_destape", desde: desdeAcarreo, hasta: hoy }),
    traerAcarreoIdsClasificadosEnDestape(supabase),
  ]);

  const pendientesAcarreo = horasDeAcarreoSinClasificar(
    acarreosHorasDestape.map((a) => ({ id: a.id, fleteroId: a.fletero_id, fecha: a.fecha, cantidad: a.cantidad })),
    acarreoIdsClasificados
  );

  return (
    // `key={mes}` fuerza a remontar el cliente al cambiar de mes: si no, un
    // registro a medio editar de otro mes podría quedar seleccionado.
    <CargarDestapeClient
      key={mes}
      mes={mes}
      yacimientos={yacimientos}
      fleteros={fleteros}
      operarios={operarios}
      equipos={equipos}
      registrosDelMes={registrosDelMes}
      pendientesAcarreo={pendientesAcarreo}
    />
  );
}
