import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerAcarreos, traerFleteros, traerPesadas, traerTarifasAcarreo } from "@/lib/cantera/consultas";
import { resumenPorFletero, type AcarreoPlano } from "@/lib/cantera/acarreo";
import { agruparPesadasPorFleteroTipoMes } from "@/lib/cantera/pesadas";
import ResumenAnualClient from "./ResumenAnualClient";

/**
 * El resumen anual por fletero: cuánto se le pagó cada mes — la misma forma
 * que la pestaña "Resumen" de la planilla real (fletero × mes, con el total
 * anual). A diferencia de `/cantera/acarreo`, que mira un mes a la vez, acá
 * se trae el año entero para poder verlo en una sola tabla.
 */
export default async function ResumenAnualPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string }>;
}) {
  const { anio: anioParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request
  const anioActual = new Date().getUTCFullYear();
  const anio = anioParam && /^\d{4}$/.test(anioParam) ? anioParam : String(anioActual);

  const [fleteros, tarifas, acarreos, pesadas] = await Promise.all([
    traerFleteros(supabase, true),
    traerTarifasAcarreo(supabase),
    traerAcarreos(supabase, {}),
    traerPesadas(supabase, {}),
  ]);

  const acarreosDelAnio: AcarreoPlano[] = [
    ...acarreos.map((a) => ({ fleteroId: a.fletero_id, tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
    ...agruparPesadasPorFleteroTipoMes(pesadas),
  ].filter((a) => a.mes.startsWith(anio));

  const MESES = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`);

  const filas = fleteros.map((f) => {
    const porMes = MESES.map((mes) => resumenPorFletero(acarreosDelAnio, tarifas, f.id, mes).totalMonto);
    return { fletero: f, porMes, totalAnual: porMes.reduce((s, v) => s + v, 0) };
  });

  return <ResumenAnualClient anio={anio} filas={filas} />;
}
