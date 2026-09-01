"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORES = ["#1E7D34", "#E8A020", "#46B869", "#C17F10", "#0E7C86", "#94A3B8"];

/**
 * Los cuatro gráficos del Analítico.
 *
 * Están aparte para que la pantalla los cargue con `next/dynamic`: `recharts`
 * son ~350 KB y su JS bloqueaba el primer pintado de todo, incluidas las cinco
 * tarjetas de arriba, que ya llegan con datos del servidor.
 */
export default function GraficosAnalitico({
  ausentismoPorMes, porGenero, porEmpresa, porAntiguedad,
}: {
  ausentismoPorMes: any[] | null;
  porGenero: any[] | null;
  porEmpresa: any[] | null;
  porAntiguedad: any[] | null;
}) {
  return (
    <>
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
    </>
  );
}
