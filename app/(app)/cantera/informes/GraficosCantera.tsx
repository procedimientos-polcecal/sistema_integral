"use client";

import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import type { FilaSerieMensual } from "@/lib/cantera/informe";

/**
 * Los gráficos de la variación mes a mes. Aparte del resto de la pantalla para
 * que el tablero los cargue con `next/dynamic`: `recharts` son ~350 KB que no
 * hace falta bajar para ver las tablas.
 *
 * Molde de `app/(app)/compras/GraficosCompras.tsx`.
 */

const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const ejeNum = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : num.format(v));

export function TendenciaToneladas({ datos }: { datos: FilaSerieMensual[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={ejeNum} />
        <Tooltip formatter={(v) => num.format(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="toneladas" name="Toneladas" fill="#1E7D34" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TendenciaUsdPorTon({ datos }: { datos: FilaSerieMensual[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={datos} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={ejeNum} />
        <Tooltip formatter={(v) => (v == null ? "—" : num.format(Number(v)))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Line type="monotone" dataKey="usdPorTon" name="USD/ton" stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TendenciaGrExplosivoPorTon({ datos }: { datos: FilaSerieMensual[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={datos} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={ejeNum} />
        <Tooltip formatter={(v) => (v == null ? "—" : num.format(Number(v)))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Line type="monotone" dataKey="grExplosivoPorTon" name="Gr expl./ton" stroke="#DC2626" strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TendenciaCostoUsd({ datos }: { datos: FilaSerieMensual[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={ejeNum} />
        <Tooltip formatter={(v) => `US$ ${num.format(Number(v))}`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="perforacionUsd" name="Perforación" stackId="c" fill="#E8A020" />
        <Bar dataKey="voladuraUsd" name="Voladura" stackId="c" fill="#2563EB" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
