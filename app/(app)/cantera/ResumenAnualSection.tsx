import { createClient } from "@/lib/supabase/server";
import { traerAcarreos, traerFleteros, traerPesadas, traerTarifasAcarreo } from "@/lib/cantera/consultas";
import { resumenPorFletero, resumenAnualPorTipo, type AcarreoPlano } from "@/lib/cantera/acarreo";
import { agruparPesadasPorFleteroTipoMes, agruparPesadasPorTipoMes } from "@/lib/cantera/pesadas";
import ResumenesAnuales from "./ResumenesAnuales";

/**
 * El resumen anual (por fletero y de materiales) aparte de `page.tsx`, en su
 * propio Server Component, para poder envolverlo en `<Suspense>`: trae el
 * año entero de pesadas y acarreos, que con 7000+ pesadas son varias tandas
 * de `traerTodo` (PostgREST corta en 1000 filas) — bloqueaba toda la página
 * de inicio hasta que terminaba, y en producción a veces ni cargaba. Ahora el
 * resto de la página (métricas del mes, Registros, Informe) se ve al toque, y
 * esto se sirve después, cuando está listo.
 */
export default async function ResumenAnualSection({ anio }: { anio: string }) {
  const supabase = await createClient();

  const [fleteros, tarifasAcarreo, acarreosDelAnio, pesadasDelAnio] = await Promise.all([
    traerFleteros(supabase, true),
    traerTarifasAcarreo(supabase),
    traerAcarreos(supabase, { anio }),
    traerPesadas(supabase, { anio }),
  ]);

  const acarreosDelAnioPlanos: AcarreoPlano[] = [
    ...acarreosDelAnio.map((a) => ({ fleteroId: a.fletero_id, tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
    ...agruparPesadasPorFleteroTipoMes(pesadasDelAnio),
  ];
  const MESES_DEL_ANIO = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`);
  const filasFleteros = fleteros.map((f) => {
    const porMes = MESES_DEL_ANIO.map((mes) => resumenPorFletero(acarreosDelAnioPlanos, tarifasAcarreo, f.id, mes).totalMonto);
    return { fletero: f, porMes, totalAnual: porMes.reduce((s, v) => s + v, 0) };
  });
  const filasMateriales = resumenAnualPorTipo(
    [
      ...acarreosDelAnio.map((a) => ({ tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
      ...agruparPesadasPorTipoMes(pesadasDelAnio),
    ],
    anio
  );

  return <ResumenesAnuales anio={anio} filasFleteros={filasFleteros} filasMateriales={filasMateriales} />;
}
