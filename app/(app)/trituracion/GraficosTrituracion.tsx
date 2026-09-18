"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";

// Verde, violeta, teal — mismo criterio que Cantera: nunca azul junto a amarillo.
export const COLORES_TRITURACION = ["#1E7D34", "#7E22CE", "#0891B2", "#C2410C", "#B45309"];

/**
 * El tinte claro de cada color de arriba — para fondos de tarjeta y cebra de
 * tabla, no sólo un borde de 3px que se puede pasar por alto. Mismo criterio
 * que VERDE_CLARO/AMBAR_CLARO del informe de Taller Vial, con un tono por
 * cada color de la paleta.
 */
export const COLOR_CLARO: Record<string, string> = {
  "#1E7D34": "#F0F8F5",
  "#7E22CE": "#F6F0FC",
  "#0891B2": "#EDFAFD",
  "#C2410C": "#FFF3EC",
  "#B45309": "#FFF7ED",
};

const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const ejeNum = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : num.format(v));

export interface SerieDePlanta {
  key: string;
  nombre: string;
  color: string;
}

/**
 * Toneladas por mes, una barra por planta (agrupadas, no apiladas: lo que
 * importa acá es comparar plantas mes a mes, no el total). `next/dynamic`
 * en `InicioGraficos.tsx` — `recharts` son ~350 KB que no hace falta bajar
 * si la página no llega a mostrarse.
 */
export interface FilaEvolucion {
  mes: string;
  [plantaKey: string]: string | number;
}

export function EvolucionToneladasPorPlanta({
  datos, series,
}: {
  datos: FilaEvolucion[];
  series: SerieDePlanta[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={ejeNum} width={36} />
        <Tooltip
          formatter={(v) => `${num.format(Number(v))} t`}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E2E8F0" }}
          labelStyle={{ color: "#0F172A", fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#475569" }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.nombre} fill={s.color} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Reparto de toneladas por material este mes, todas las plantas juntas. */
export function RepartoPorMaterial({ datos }: { datos: { material: string; toneladas: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={datos} dataKey="toneladas" nameKey="material" innerRadius={42} outerRadius={75} paddingAngle={2}>
          {datos.map((_, i) => <Cell key={i} fill={COLORES_TRITURACION[i % COLORES_TRITURACION.length]} />)}
        </Pie>
        <Tooltip
          formatter={(v) => `${num.format(Number(v))} t`}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E2E8F0" }}
          labelStyle={{ color: "#0F172A", fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#475569" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
