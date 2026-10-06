import { createClient } from "@/lib/supabase/server";
import { traerAcarreos, traerFleteros, traerPesadasAgrupadasPorFleteroTipoMes, traerTarifasAcarreo } from "@/lib/cantera/consultas";
import { resumenPorFletero, resumenAnualPorTipo, type AcarreoPlano } from "@/lib/cantera/acarreo";
import { planasDesdePesadasAgrupadas, sumarPesadasAgrupadasPorTipoMes } from "@/lib/cantera/pesadas";
import ResumenesAnuales from "./ResumenesAnuales";

/**
 * El resumen anual (por fletero y de materiales) aparte de `page.tsx`, en su
 * propio Server Component, para poder envolverlo en `<Suspense>`.
 *
 * Traía `cantera_pesadas` filtrada por año para agruparla acá — pero TODAS
 * las 7623+ pesadas de la base son del año en curso (verificado el
 * 22/09/2026), así que filtrar por año no achicaba nada: era la tabla
 * entera igual, 8 páginas de `traerTodo` (PostgREST corta en 1000 filas).
 * Bloqueaba esta sección hasta que terminaba y, en producción, a veces ni
 * cargaba. Ahora la suma por fletero+tipo+mes se hace en la base
 * (`cantera_pesadas_por_fletero_tipo_mes()`, migración `20260922093520`) —
 * un puñado de filas en vez de miles.
 */
export default async function ResumenAnualSection({ anio }: { anio: string }) {
  const supabase = await createClient();

  const [fleteros, tarifasAcarreo, acarreosDelAnio, pesadasAgrupadas] = await Promise.all([
    traerFleteros(supabase, true),
    traerTarifasAcarreo(supabase),
    traerAcarreos(supabase, { anio }),
    traerPesadasAgrupadasPorFleteroTipoMes(supabase, anio),
  ]);

  const acarreosDelAnioPlanos: AcarreoPlano[] = [
    ...acarreosDelAnio.map((a) => ({ fleteroId: a.fletero_id, tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
    ...planasDesdePesadasAgrupadas(pesadasAgrupadas),
  ];
  const MESES_DEL_ANIO = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`);
  const filasFleteros = fleteros.map((f) => {
    const porMes = MESES_DEL_ANIO.map((mes) => resumenPorFletero(acarreosDelAnioPlanos, tarifasAcarreo, f.id, mes).totalMonto);
    return { fletero: f, porMes, totalAnual: porMes.reduce((s, v) => s + v, 0) };
  });
  const filasMateriales = resumenAnualPorTipo(
    [
      ...acarreosDelAnio.map((a) => ({ tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
      ...sumarPesadasAgrupadasPorTipoMes(pesadasAgrupadas),
    ],
    anio
  );

  return <ResumenesAnuales anio={anio} filasFleteros={filasFleteros} filasMateriales={filasMateriales} />;
}
