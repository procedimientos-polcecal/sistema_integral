"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ResumenAnalitico } from "@/lib/rrhh/analiticoResumen";

/**
 * Los gráficos, aparte: `recharts` son ~350 KB y su JS bloqueaba el primer
 * pintado de las cinco tarjetas, que ya llegan calculadas del servidor.
 * `ssr: false` porque miden el contenedor para dibujarse.
 */
const GraficosAnalitico = dynamic(() => import("./GraficosAnalitico"), {
  ssr: false,
  loading: () => <div className="card p-5 h-[320px] animate-pulse mb-6" />,
});

function StatCard({ titulo, valor, sufijo }: { titulo: string; valor: string | number; sufijo?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs text-gray-500">{titulo}</div>
      <div className="text-3xl font-bold text-gray-900 mt-2">
        {valor}
        {sufijo && <span className="text-lg text-gray-400 ml-1">{sufijo}</span>}
      </div>
    </div>
  );
}

export default function AnaliticoClient({ resumenInicial }: { resumenInicial: ResumenAnalitico }) {
  // Arranca con lo que calculó el servidor: las cinco tarjetas se ven en el
  // primer pintado, sin "-" ni salto de layout.
  const [resumen] = useState<ResumenAnalitico>(resumenInicial);
  const [ausentismoPorMes, setAusentismoPorMes] = useState<any[] | null>(null);
  const [porGenero, setPorGenero] = useState<any[] | null>(null);
  const [porAntiguedad, setPorAntiguedad] = useState<any[] | null>(null);
  const [porEmpresa, setPorEmpresa] = useState<any[] | null>(null);

  useEffect(() => {
    fetch("/api/rrhh/analitico/ausentismo-por-mes").then((r) => r.json()).then(setAusentismoPorMes);
    fetch("/api/rrhh/analitico/por-genero").then((r) => r.json()).then(setPorGenero);
    fetch("/api/rrhh/analitico/por-antiguedad").then((r) => r.json()).then(setPorAntiguedad);
    fetch("/api/rrhh/analitico/por-empresa").then((r) => r.json()).then(setPorEmpresa);
  }, []);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Analítico de personal</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard titulo="Empleados" valor={resumen.cantidadEmpleados ?? "-"} />
        <StatCard titulo="Ausentismo" valor={resumen.ausentismo ?? "-"} sufijo="%" />
        <StatCard titulo="Tardanza" valor={resumen.tardanza ?? "-"} sufijo="%" />
        <StatCard titulo="Edad promedio" valor={resumen.promedioEdad ?? "-"} sufijo="años" />
        <StatCard titulo="Antigüedad promedio" valor={resumen.promedioAntiguedad ?? "-"} sufijo="años" />
      </div>

      <GraficosAnalitico
        ausentismoPorMes={ausentismoPorMes}
        porGenero={porGenero}
        porEmpresa={porEmpresa}
        porAntiguedad={porAntiguedad}
      />
    </div>
  );
}
