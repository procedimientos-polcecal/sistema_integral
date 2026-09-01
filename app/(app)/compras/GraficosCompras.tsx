"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { moneda } from "@/lib/compras/constants";

/**
 * Los tres gráficos del tablero de Compras.
 *
 * Están aparte para que el tablero los cargue con `next/dynamic`: `recharts`
 * son ~350 KB y su JS bloqueaba el primer pintado de toda la pantalla,
 * incluidos los seis indicadores y las tablas, que no lo necesitan.
 *
 * Se exporta un componente por gráfico y no un bloque único porque en el
 * tablero los gráficos están intercalados con tablas en la misma grilla: así el
 * armado de la página queda intacto y sólo se difiere el interior.
 */

const COLORES = ["#1E7D34", "#E8A020", "#2563EB", "#DC2626", "#7E22CE", "#0891B2"];

// Copiado tal cual del tablero: cambiarlo acá cambiaría las etiquetas de los
// ejes, y esto es una mudanza de archivo, no un rediseño.
const abreviar = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : `${Math.round(v / 1000)}k`;

export function GastoPorMes({ datos }: { datos: { mes: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false}
          tickFormatter={(v: number) => abreviar(v)} />
        <Tooltip formatter={(v) => moneda(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="total" fill="#1E7D34" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GastoPorEmpresa({ datos }: { datos: { nombre: string; valor: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={datos} dataKey="valor" nameKey="nombre" innerRadius={50} outerRadius={85} paddingAngle={2}>
          {datos.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => moneda(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function GastoPorArea({ datos }: { datos: { nombre: string; valor: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false}
          tickFormatter={(v: number) => abreviar(v)} />
        <YAxis type="category" dataKey="nombre" width={110}
          tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => moneda(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="valor" fill="#E8A020" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
