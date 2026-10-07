"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MesDeMuestras, PuntoDeSerie } from "@/lib/calidad/ensayos/indicadores";

/**
 * Los gráficos de los indicadores de ensayo.
 *
 * Aparte de la pantalla para que entre con `next/dynamic`: `recharts` son ~350
 * KB que no hace falta bajar para ver las tablas. Molde de
 * `app/(app)/cantera/informes/GraficosCantera.tsx`.
 */

const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function comoSeLee(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * La serie de una determinación en el tiempo, con sus límites dibujados.
 *
 * Las líneas de límite son el punto del gráfico: una humedad de 1,2% no dice
 * nada sola, y contra un techo de 1% dice todo. Si no hay límite cargado no se
 * dibuja ninguna — y eso también se ve, que es lo que se quiere.
 */
export function SerieDeLaDeterminacion({
  datos,
  unidad,
  minimo,
  maximo,
}: {
  datos: PuntoDeSerie[];
  unidad: string;
  minimo: number | null;
  maximo: number | null;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={datos} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis
          dataKey="fecha"
          tickFormatter={comoSeLee}
          tick={{ fontSize: 11, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          width={48}
          domain={["auto", "auto"]}
        />
        <Tooltip
          labelFormatter={(v) => comoSeLee(String(v))}
          formatter={(v) => [`${num.format(Number(v))} ${unidad}`, "Valor"]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        {maximo !== null && (
          <ReferenceLine
            y={maximo}
            stroke="#B91C1C"
            strokeDasharray="4 4"
            label={{ value: `máx ${num.format(maximo)}`, position: "insideTopRight", fontSize: 10, fill: "#B91C1C" }}
          />
        )}
        {minimo !== null && (
          <ReferenceLine
            y={minimo}
            stroke="#B91C1C"
            strokeDasharray="4 4"
            label={{ value: `mín ${num.format(minimo)}`, position: "insideBottomRight", fontSize: 10, fill: "#B91C1C" }}
          />
        )}
        {/*
          `connectNulls` no hace falta porque la serie ya viene sin los días sin
          dato: una línea que baja a cero porque ese día no se midió es una
          mentira que se lee de un vistazo.
        */}
        <Line
          type="monotone"
          dataKey="valor"
          name="Valor"
          stroke="#1E7D34"
          strokeWidth={2}
          dot={{ r: 2.5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Cuántas muestras por mes, y cuántas se fueron de límite. */
export function MuestrasPorMes({ datos }: { datos: MesDeMuestras[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="muestras" name="Muestras" fill="#1E7D34" radius={[4, 4, 0, 0]} />
        <Bar dataKey="fueraDeLimite" name="Fuera de límite" fill="#B91C1C" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
