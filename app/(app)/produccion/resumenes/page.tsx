import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina, rangoDelMes, esMesValido } from "@/lib/core/fechas";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { armarElMes } from "@/lib/produccion/consultas";
import ResumenesClient from "./ResumenesClient";

/**
 * El mes por producto: lo que hoy son las tres hojas de resumen del Excel.
 *
 * Toda la aritmética (producción despejada, despacho y rotura sumados) sale
 * de `armarElMes`, que a su vez reusa las mismas funciones de `lib/produccion/`
 * con las que se exporta a la planilla. Acá no se calcula nada: sólo se trae
 * el mes y se le pasa al cliente para mostrarlo.
 */
export default async function ResumenesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: pedido } = await searchParams;
  const mes = esMesValido(pedido) ? pedido : hoyEnArgentina().slice(0, 7);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const { primerDia, ultimoDia } = rangoDelMes(mes);
  const { renglonesDePapel, dias } = await armarElMes(supabase, primerDia, ultimoDia);

  return <ResumenesClient mes={mes} renglonesDePapel={renglonesDePapel} dias={dias} />;
}
