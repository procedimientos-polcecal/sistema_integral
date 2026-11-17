import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esAdminDelNucleo } from "@/lib/core/access";
import { leerLaSalud } from "@/lib/core/saludDeLasSincronizaciones";
import SaludClient from "./SaludClient";

/**
 * La pantalla donde aterrizan la campana y el resumen diario cuando una
 * sincronización se cae. **Sin ella el resto no sirve**: un aviso que lleva a un
 * lugar donde no hay rastro del problema es el bug del mes de notificaciones que
 * abrían el inicio.
 *
 * Lee con el cliente de quien mira y no con el admin, igual que la campana
 * (`api/home/avisos`): lo que esta pantalla dice es lo que la campana vio, y si
 * alguna vez difieren, la diferencia es el dato.
 */
export default async function SaludPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!esAdminDelNucleo(usuario?.rol)) redirect("/");

  // Una sola `ahora` para leer y para dibujar: si cada una tomara la suya, una
  // corrida que está justo en el borde de su tolerancia saldría «sana» en la
  // lectura y «hace 25 h» en pantalla.
  const ahora = new Date();
  const salud = await leerLaSalud(supabase, ahora);

  return <SaludClient salud={salud} ahora={ahora.toISOString()} />;
}
