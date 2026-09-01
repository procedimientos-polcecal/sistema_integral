"use client";

import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";

/**
 * Los cuatro gráficos del tablero de Mantenimiento.
 *
 * Están aparte para que el tablero los cargue con `next/dynamic`: `recharts`
 * son ~350 KB y su JS bloqueaba el primer pintado de toda la pantalla —los
 * indicadores, los avisos, las listas de atrasos—, que no lo necesitan.
 *
 * Un componente por gráfico y no un bloque único porque en el tablero están
 * repartidos entre varios subcomponentes: así el armado de la página queda
 * intacto y sólo se difiere el interior de cada uno.
 *
 * Todo el contenido está copiado tal cual del tablero. Es una mudanza de
 * archivo, no un rediseño: cualquier ajuste de colores, márgenes o formato
 * cambiaría lo que se ve.
 */

const TOOLTIP = { borderRadius: 8, fontSize: 12, border: "1px solid #E2E8F0" } as const;
const CURSOR = { fill: "#F8FAFC" } as const;

/** OTs generadas por mes. El mes en curso va destacado. */
export function OtsPorMes({ datos }: { datos: { mes: string; cantidad: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={datos} barSize={16}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
        <XAxis
          dataKey="mes"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={TOOLTIP} formatter={(v) => [`${v ?? 0} OTs`, ""]} cursor={CURSOR} />
        <Bar dataKey="cantidad" radius={[4, 4, 0, 0]} name="OTs">
          {/* El mes en curso, destacado: es el único que todavía puede cambiar,
              y compararlo con los cerrados sin verlo distinto hace creer que la
              actividad cayó. */}
          {datos.map((_, i) => (
            <Cell key={i} fill={i === datos.length - 1 ? "#1D4ED8" : "#93C5FD"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Estado del parque de equipos. */
export function EstadoDeEquipos({
  datos,
}: {
  datos: { key: string; value: number; color: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={datos} cx="50%" cy="50%" innerRadius={44} outerRadius={70} paddingAngle={2} dataKey="value" strokeWidth={0}>
          {datos.map((d) => <Cell key={d.key} fill={d.color} />)}
        </Pie>
        <Tooltip formatter={(val: any, name: any) => [`${val} equipos`, name]} contentStyle={TOOLTIP} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Criticidad, agrupada por empresa o por sector según el filtro. */
export function Criticidad({
  datos, claves, colores,
}: {
  datos: Record<string, unknown>[];
  claves: string[];
  colores: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={176}>
      <BarChart data={datos} barSize={18} barCategoryGap="35%">
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
        <XAxis dataKey="criticidad" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} />
        {claves.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
        {claves.map((key) => <Bar key={key} dataKey={key} fill={colores[key] ?? "#94A3B8"} radius={[4, 4, 0, 0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ejecuciones por semana. */
export function EjecucionesPorSemana({ datos }: { datos: { semana: string; cantidad: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={datos} barSize={28}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
        <XAxis dataKey="semana" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP} formatter={(v: any) => [`${v} ejecuciones`]} cursor={CURSOR} />
        <Bar dataKey="cantidad" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Ejecuciones" />
      </BarChart>
    </ResponsiveContainer>
  );
}
