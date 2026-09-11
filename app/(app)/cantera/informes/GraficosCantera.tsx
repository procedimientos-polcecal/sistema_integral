"use client";

import {
  LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import type { FilaSerieMensual, ResumenPorCantera } from "@/lib/cantera/informe";

// Verde, violeta, teal, terracota — nunca azul junto a amarillo.
const COLORES_CANTERA = ["#1E7D34", "#7E22CE", "#0891B2", "#C2410C", "#B45309"];

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
        {/* Verde y violeta, nunca azul con amarillo. */}
        <Bar dataKey="perforacionUsd" name="Perforación" stackId="c" fill="#1E7D34" />
        <Bar dataKey="voladuraUsd" name="Voladura" stackId="c" fill="#7E22CE" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * El adelanto de la página de inicio del módulo: toneladas (barras) y
 * USD/ton (línea, eje derecho) en un solo gráfico, para que se vea de un
 * vistazo que se cargó más y salió más caro/barato en el mismo golpe de
 * vista — es la lectura que en el informe completo exige mirar dos gráficos
 * separados.
 */
export function ResumenMensualMini({ datos }: { datos: FilaSerieMensual[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={datos} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="ton" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={ejeNum} width={36} />
        <YAxis yAxisId="usd" orientation="right" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={ejeNum} width={30} />
        <Tooltip
          formatter={(v, n) => [n === "USD/ton" ? (v == null ? "—" : `US$ ${num.format(Number(v))}`) : num.format(Number(v)), n]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="ton" dataKey="toneladas" name="Toneladas" fill="#1E7D34" radius={[4, 4, 0, 0]} />
        <Line yAxisId="usd" type="monotone" dataKey="usdPorTon" name="USD/ton" stroke="#7E22CE" strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Los dos gráficos del informe generado — calcados de los que trae la
 * planilla ("Costo Total USD por Cantera" y "Costo USD/Ton por Cantera"), pero
 * por el período que se haya elegido en vez de fijos a un mes.
 */
export function TortaCostoPorCantera({ datos }: { datos: ResumenPorCantera[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={datos} dataKey="costoTotalUsd" nameKey="cantera" innerRadius={45} outerRadius={80} paddingAngle={2}>
          {datos.map((_, i) => <Cell key={i} fill={COLORES_CANTERA[i % COLORES_CANTERA.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => `US$ ${num.format(Number(v))}`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function BarraUsdPorTonPorCantera({ datos }: { datos: ResumenPorCantera[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="cantera" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={40} />
        <Tooltip formatter={(v) => (v == null ? "—" : num.format(Number(v)))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="usdPorTon" name="USD/Ton" fill="#1E7D34" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
