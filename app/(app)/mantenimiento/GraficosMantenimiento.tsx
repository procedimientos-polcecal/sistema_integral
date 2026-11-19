"use client";

import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  LineChart, Line,
} from "recharts";

/**
 * Los gráficos del tablero de Mantenimiento.
 *
 * Están aparte para que el tablero los cargue con `next/dynamic`: `recharts`
 * son ~350 KB y su JS bloqueaba el primer pintado de toda la pantalla —los
 * indicadores, los avisos, las listas de atrasos—, que no lo necesitan.
 *
 * Un componente por gráfico y no un bloque único porque en el tablero están
 * repartidos entre varios subcomponentes: así el armado de la página queda
 * intacto y sólo se difiere el interior de cada uno.
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
            <Cell key={i} fill={i === datos.length - 1 ? "var(--primary)" : "rgba(30,125,52,0.35)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Fallas correctivas por mes de un equipo, los últimos 12. El mes en curso va
 * con menos opacidad y borde punteado: le faltan días, y compararlo con los
 * cerrados sin verlo distinto hace creer que el equipo mejoró.
 */
export function FallasPorMes({
  datos, mesEnCurso,
}: {
  datos: { etiqueta: string; cantidad: number }[];
  mesEnCurso: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={datos} barSize={16}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
        <XAxis
          dataKey="etiqueta"
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
        <Tooltip
          contentStyle={TOOLTIP}
          cursor={CURSOR}
          labelFormatter={(l) => (l === mesEnCurso ? `${l} (incompleto)` : String(l))}
          formatter={(v) => [`${v ?? 0} ${v === 1 ? "falla" : "fallas"}`, ""]}
        />
        <Bar dataKey="cantidad" radius={[4, 4, 0, 0]} name="Fallas">
          {datos.map((d) => (
            <Cell
              key={d.etiqueta}
              fill="var(--primary)"
              fillOpacity={d.etiqueta === mesEnCurso ? 0.35 : 1}
              stroke={d.etiqueta === mesEnCurso ? "var(--primary)" : "none"}
              strokeDasharray="3 2"
            />
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
        <Bar dataKey="cantidad" fill="var(--primary)" radius={[4, 4, 0, 0]} name="Ejecuciones" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Órdenes generadas por mes, apiladas por empresa o por sector según el filtro.
 *
 * El agrupamiento lo decide quien llama, con la misma regla que `Criticidad`:
 * sin filtro, por empresa; con una empresa, por sus sectores; con un sector,
 * ése solo. Apilar los quince sectores a la vez no se lee.
 *
 * **Cuenta por la fecha de carga**, igual que `OtsPorMes`, que vive debajo en
 * la misma sección: con fechas distintas las barras de los dos no sumarían lo
 * mismo y nada lo diría.
 */
export function OrdenesPorMesYSector({
  datos, claves, colores,
}: {
  datos: Record<string, unknown>[];
  claves: string[];
  colores: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={datos} barSize={16}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
        <XAxis
          dataKey="etiqueta"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} />
        {claves.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
        {claves.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="ot"
            fill={colores[key] ?? "#94A3B8"}
            // Sólo la de arriba lleva las esquinas redondeadas: aplicadas a
            // todas, cada tramo de la pila se ve como una barra suelta.
            radius={i === claves.length - 1 ? [4, 4, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Cómo viene la confiabilidad de cada sector, mes a mes.
 *
 * **`connectNulls={false}` es la línea que sostiene la decisión entera.** Un
 * punto en `null` es un mes que no se pudo medir —menos de tres fallas en su
 * ventana, o menos días observados que el piso—, y unirlo con una recta
 * dibujaría una medición que nadie hizo. Es la misma regla que la curva
 * granulométrica de Calidad.
 *
 * El eje va de 0 a 1 y se escribe en porcentaje; el mes en curso se nombra
 * como incompleto en el tooltip, porque su ventana termina hoy.
 */
export function ConfiabilidadPorSector({
  datos, claves, colores, mesEnCurso,
}: {
  datos: Record<string, unknown>[];
  claves: string[];
  colores: Record<string, string>;
  mesEnCurso: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={datos}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
        <XAxis
          dataKey="etiqueta"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fontSize: 11, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={TOOLTIP}
          labelFormatter={(l) => (l === mesEnCurso ? `${l} (incompleto)` : String(l))}
          formatter={(v: any, name: any) => [
            v === null || v === undefined ? "sin medir" : `${(Number(v) * 100).toFixed(1)}%`,
            name,
          ]}
        />
        {claves.length > 1 && <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 11 }} />}
        {claves.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={colores[key] ?? "#94A3B8"}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
