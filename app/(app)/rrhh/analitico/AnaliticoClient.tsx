"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORES = ["#1E7D34", "#E8A020", "#46B869", "#C17F10", "#0E7C86", "#94A3B8"];

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

export default function AnaliticoClient() {
  const [resumen, setResumen] = useState<any | null>(null);
  const [ausentismoPorMes, setAusentismoPorMes] = useState<any[] | null>(null);
  const [porGenero, setPorGenero] = useState<any[] | null>(null);
  const [porAntiguedad, setPorAntiguedad] = useState<any[] | null>(null);
  const [porEmpresa, setPorEmpresa] = useState<any[] | null>(null);

  useEffect(() => {
    fetch("/api/rrhh/analitico/resumen").then((r) => r.json()).then(setResumen);
    fetch("/api/rrhh/analitico/ausentismo-por-mes").then((r) => r.json()).then(setAusentismoPorMes);
    fetch("/api/rrhh/analitico/por-genero").then((r) => r.json()).then(setPorGenero);
    fetch("/api/rrhh/analitico/por-antiguedad").then((r) => r.json()).then(setPorAntiguedad);
    fetch("/api/rrhh/analitico/por-empresa").then((r) => r.json()).then(setPorEmpresa);
  }, []);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Analítico de personal</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard titulo="Empleados" valor={resumen?.cantidadEmpleados ?? "-"} />
        <StatCard titulo="Ausentismo" valor={resumen?.ausentismo ?? "-"} sufijo="%" />
        <StatCard titulo="Tardanza" valor={resumen?.tardanza ?? "-"} sufijo="%" />
        <StatCard titulo="Edad promedio" valor={resumen?.promedioEdad ?? "-"} sufijo="años" />
        <StatCard titulo="Antigüedad promedio" valor={resumen?.promedioAntiguedad ?? "-"} sufijo="años" />
      </div>

      <div className="card p-5 mb-6">
        <h2 className="font-medium text-gray-700 mb-3">Índice de ausentismo por mes</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={ausentismoPorMes ?? []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v: any) => `${v}%`} />
            <Line type="monotone" dataKey="ausentismo" name="Ausentismo" stroke="#E8A020" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Empleados por género</h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={porGenero ?? []} dataKey="cantidad" nameKey="genero" cx="50%" cy="50%" outerRadius={90} label>
                {(porGenero ?? []).map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="font-medium text-gray-700 mb-3">Empleados por empresa</h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={porEmpresa ?? []} dataKey="cantidad" nameKey="empresa" cx="50%" cy="50%" outerRadius={90} label>
                {(porEmpresa ?? []).map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-medium text-gray-700 mb-3">Empleados por antigüedad</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={porAntiguedad ?? []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="rango" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="cantidad" name="Empleados" fill="#1E7D34" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
