import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerDatosParaInforme } from "@/lib/cantera/consultas";
import { armarInforme, serieMensual } from "@/lib/cantera/informe";
import InformeClient from "./InformeClient";

/**
 * El informe de cantera: un histórico con la variación mes a mes (para tener
 * el pulso sin generar nada), y un botón "Generar informe" que arma las tablas
 * de un rango de fechas puntual —como las que hoy arma el Apps Script sobre la
 * planilla— con su export a Excel. No escribe el informe en prosa: da los
 * números para que la persona lo escriba.
 */
export default async function InformesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const { desde, hasta } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const { voladuras, bochones } = await traerDatosParaInforme(supabase);
  const serie = serieMensual(voladuras, bochones);

  const rangoValido =
    desde && hasta && /^\d{4}-\d{2}-\d{2}$/.test(desde) && /^\d{4}-\d{2}-\d{2}$/.test(hasta);
  const informe = rangoValido ? armarInforme(desde!, hasta!, voladuras, bochones) : null;

  return (
    <InformeClient
      serie={serie}
      informe={informe}
      desde={desde ?? ""}
      hasta={hasta ?? ""}
    />
  );
}
