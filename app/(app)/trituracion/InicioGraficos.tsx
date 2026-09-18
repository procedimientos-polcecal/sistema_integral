"use client";

import dynamic from "next/dynamic";
import type { FilaEvolucion, SerieDePlanta } from "./GraficosTrituracion";

/**
 * Los dos gráficos de la página de inicio, en un solo componente de cliente
 * — el resto de `page.tsx` es server-only. Mismo criterio que
 * `app/(app)/cantera/InicioGrafico.tsx`: `recharts` va con `next/dynamic` y
 * sin SSR.
 */
const EvolucionToneladasPorPlanta = dynamic(
  () => import("./GraficosTrituracion").then((m) => m.EvolucionToneladasPorPlanta),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" /> }
);
const RepartoPorMaterial = dynamic(
  () => import("./GraficosTrituracion").then((m) => m.RepartoPorMaterial),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" /> }
);

export function GraficoEvolucion({
  datos, series,
}: {
  datos: FilaEvolucion[];
  series: SerieDePlanta[];
}) {
  return <EvolucionToneladasPorPlanta datos={datos} series={series} />;
}

export function GraficoMateriales({ datos }: { datos: { material: string; toneladas: number }[] }) {
  return <RepartoPorMaterial datos={datos} />;
}
