"use client";

import dynamic from "next/dynamic";
import type { FilaSerieMensual } from "@/lib/cantera/informe";

/**
 * El único componente de cliente de la página de inicio: el gráfico del
 * informe. Todo el resto de `page.tsx` es server-only. `recharts` son ~350 KB
 * que no hace falta bajar si esto no se llega a ver (misma razón que
 * `InformeClient.tsx`), así que va con `next/dynamic` y sin SSR.
 */
const ResumenMensualMini = dynamic(
  () => import("./informes/GraficosCantera").then((m) => m.ResumenMensualMini),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" /> }
);

export default function InicioGrafico({ datos }: { datos: FilaSerieMensual[] }) {
  return <ResumenMensualMini datos={datos} />;
}
