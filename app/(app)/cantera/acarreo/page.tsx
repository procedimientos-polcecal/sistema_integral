import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerAcarreos, traerFleteros, traerTarifasAcarreo } from "@/lib/cantera/consultas";
import { resumenPorFletero, toneladasPorYacimiento, type AcarreoPlano } from "@/lib/cantera/acarreo";
import AcarreoClient from "./AcarreoClient";

/**
 * El tablero de acarreo: cuánto transportó cada fletero en el mes elegido —y
 * cuánto se le paga—, y de qué yacimiento vino la piedra. Por defecto el mes
 * en curso; se puede mirar cualquier otro.
 */
export default async function AcarreoPage({
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

  const [fleteros, tarifas, acarreosDelMes] = await Promise.all([
    traerFleteros(supabase, true),
    traerTarifasAcarreo(supabase),
    traerAcarreos(supabase, { mes }),
  ]);

  const acarreosPlanos: AcarreoPlano[] = acarreosDelMes.map((a) => ({
    fleteroId: a.fletero_id,
    tipo: a.tipo,
    mes: a.mes,
    cantidad: a.cantidad,
  }));

  const resumenes = fleteros
    .map((f) => ({ fletero: f, resumen: resumenPorFletero(acarreosPlanos, tarifas, f.id, mes) }))
    .filter((r) => r.resumen.porTipo.length > 0);

  const toneladas = toneladasPorYacimiento(acarreosPlanos);
  const totalGeneral = resumenes.reduce((s, r) => s + r.resumen.totalMonto, 0);

  return (
    <AcarreoClient
      mes={mes}
      resumenes={resumenes.map((r) => ({ fletero: r.fletero, resumen: r.resumen }))}
      toneladas={toneladas}
      totalGeneral={totalGeneral}
      puedeEditar={permisos.puedeEditar}
      esAdmin={permisos.esAdmin}
    />
  );
}
