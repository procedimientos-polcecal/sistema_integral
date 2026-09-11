import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerDatosParaInforme, traerYacimientos } from "@/lib/cantera/consultas";
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

  const [{ voladuras, bochones }, yacimientos] = await Promise.all([
    traerDatosParaInforme(supabase),
    traerYacimientos(supabase, true),
  ]);

  // La serie de todas juntas, y una por cantera — son ~8 meses × 5 canteras,
  // así que se calculan todas de una y el cliente elige cuál mostrar sin ir de
  // nuevo al servidor.
  const serieTodas = serieMensual(voladuras, bochones);
  const seriePorCantera = Object.fromEntries(
    yacimientos.map((y) => [y.codigo, serieMensual(voladuras, bochones, y.codigo)])
  );

  const rangoValido =
    desde && hasta && /^\d{4}-\d{2}-\d{2}$/.test(desde) && /^\d{4}-\d{2}-\d{2}$/.test(hasta);
  const informe = rangoValido ? armarInforme(desde!, hasta!, voladuras, bochones) : null;

  return (
    <InformeClient
      serieTodas={serieTodas}
      seriePorCantera={seriePorCantera}
      canteras={yacimientos.map((y) => y.codigo)}
      informe={informe}
      desde={desde ?? ""}
      hasta={hasta ?? ""}
    />
  );
}
