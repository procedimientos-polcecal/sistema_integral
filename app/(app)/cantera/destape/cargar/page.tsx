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

/** Cargar un recurso de destape (máquina propia + operario, o fletero + camión) para un día. */
export default async function CargarDestapePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelCanteraDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel === "lectura") redirect("/cantera/destape");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = new Date(new Date(hoy).getTime() - 7 * 86400000).toISOString().slice(0, 10);
  // Ventana más ancha para las horas de Acarreo sin clasificar: puede
  // quedar una carga sin elegir yacimiento varios días, y acá es donde se
  // la va a buscar para completarla.
  const desdeAcarreo = new Date(new Date(hoy).getTime() - 60 * 86400000).toISOString().slice(0, 10);

  const [yacimientos, fleteros, operarios, equipos, recientes, acarreosHorasDestape, acarreoIdsClasificados] = await Promise.all([
    traerYacimientos(supabase, true),
    traerFleteros(supabase, true),
    traerOperariosDeCantera(supabase),
    traerEquiposTallerVial(supabase),
    traerDestape(supabase, { desde, hasta: hoy }),
    traerAcarreos(supabase, { tipo: "horas_destape", desde: desdeAcarreo, hasta: hoy }),
    traerAcarreoIdsClasificadosEnDestape(supabase),
  ]);

  const pendientesAcarreo = horasDeAcarreoSinClasificar(
    acarreosHorasDestape.map((a) => ({ id: a.id, fleteroId: a.fletero_id, fecha: a.fecha, cantidad: a.cantidad })),
    acarreoIdsClasificados
  );

  return (
    <CargarDestapeClient
      yacimientos={yacimientos}
      fleteros={fleteros}
      operarios={operarios}
      equipos={equipos}
      recientes={recientes}
      pendientesAcarreo={pendientesAcarreo}
    />
  );
}
