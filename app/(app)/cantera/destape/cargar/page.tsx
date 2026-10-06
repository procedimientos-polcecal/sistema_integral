import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelCanteraDe } from "@/lib/cantera/auth";
import { traerDestape, traerFleteros, traerOperariosDeCantera, traerYacimientos } from "@/lib/cantera/consultas";
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

  const [yacimientos, fleteros, operarios, equipos, recientes] = await Promise.all([
    traerYacimientos(supabase, true),
    traerFleteros(supabase, true),
    traerOperariosDeCantera(supabase),
    traerEquiposTallerVial(supabase),
    traerDestape(supabase, { desde, hasta: hoy }),
  ]);

  return (
    <CargarDestapeClient
      yacimientos={yacimientos}
      fleteros={fleteros}
      operarios={operarios}
      equipos={equipos}
      recientes={recientes}
    />
  );
}
