import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerAcarreos, traerFleteros, traerPesadas, traerTarifasAcarreo } from "@/lib/cantera/consultas";
import { resumenPorFletero, totalesPorTipo, type AcarreoPlano } from "@/lib/cantera/acarreo";
import {
  agruparPesadasPorFleteroTipoMes,
  agruparPesadasPorTipoMes,
  toneladasPorYacimientoDesdePesadas,
} from "@/lib/cantera/pesadas";
import AcarreoClient from "./AcarreoClient";

/**
 * El tablero de acarreo: cuánto transportó cada fletero en el mes elegido —y
 * cuánto se le paga—, y de qué yacimiento vino la piedra. Por defecto el mes
 * en curso; se puede mirar cualquier otro.
 *
 * El material (toneladas) sale de `cantera_pesadas` —la pesada real de
 * balanza, ya resuelta a fletero y tipo—; las tres actividades sin pesada
 * (horas de destape, viajes de bloques, horas de bochones) salen de
 * `cantera_acarreos`, que es lo único que se carga a mano. Se juntan en un
 * solo arreglo (`AcarreoPlano[]`) antes de resumir: `resumenPorFletero` no
 * necesita saber de cuál de las dos vino cada renglón.
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

  const [fleteros, tarifas, acarreosDelMes, pesadasDelMes] = await Promise.all([
    traerFleteros(supabase, true),
    traerTarifasAcarreo(supabase),
    traerAcarreos(supabase, { mes }),
    traerPesadas(supabase, { mes }),
  ]);

  const acarreosPlanos: AcarreoPlano[] = [
    ...acarreosDelMes.map((a) => ({ fleteroId: a.fletero_id, tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
    ...agruparPesadasPorFleteroTipoMes(pesadasDelMes),
  ];

  const resumenes = fleteros
    .map((f) => ({ fletero: f, resumen: resumenPorFletero(acarreosPlanos, tarifas, f.id, mes) }))
    .filter((r) => r.resumen.porTipo.length > 0);

  // Por origen real de la pesada, no por fletero ni por nombre de material —
  // ver el comentario grande en `toneladasPorYacimientoDesdePesadas`.
  const toneladas = toneladasPorYacimientoDesdePesadas(pesadasDelMes);
  const totalGeneral = resumenes.reduce((s, r) => s + r.resumen.totalMonto, 0);
  const sinFleteroResuelto = pesadasDelMes.filter((p) => !p.fletero_id).length;

  // Todo lo que la empresa movió ese mes, material + actividades, sin
  // depender de a quién se le pudo atribuir el viaje — "RESUMEN ANUAL DE
  // MATERIALES" de la planilla real. Las pesadas van sin filtrar por
  // fletero a propósito (ver `agruparPesadasPorTipoMes`).
  const totalesDelMes = totalesPorTipo(
    [
      ...acarreosDelMes.map((a) => ({ tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
      ...agruparPesadasPorTipoMes(pesadasDelMes),
    ],
    mes
  );

  return (
    <AcarreoClient
      mes={mes}
      resumenes={resumenes.map((r) => ({ fletero: r.fletero, resumen: r.resumen }))}
      toneladas={toneladas}
      totalesDelMes={totalesDelMes}
      totalGeneral={totalGeneral}
      puedeEditar={permisos.puedeEditar}
      esAdmin={permisos.esAdmin}
      sinFleteroResuelto={sinFleteroResuelto}
    />
  );
}
