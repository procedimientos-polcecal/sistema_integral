"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PuntoDeLaCurva } from "@/lib/calidad/ensayos/curva";

/**
 * Los dos gráficos de la curva granulométrica de una muestra.
 *
 * Aparte de la pantalla para que entre con `next/dynamic`, como los de
 * `indicadores/GraficosEnsayos.tsx`: `recharts` son ~350 KB que no hace falta
 * bajar para ver los selectores. Los ejes y la grilla tienen los mismos colores
 * que ése para que las dos pantallas se vean de la misma familia.
 *
 * **Una sola curva por gráfico: la de los tamices prendidos.** Sin línea
 * punteada con la curva previa a la exclusión y sin marca en el hueco del
 * tamiz apagado.
 *
 * El eje X es la malla, **categórico**: los tamices quedan igualmente
 * espaciados, que es como se lee una granulometría en la planilla. No hay una
 * tabla de aberturas en milímetros en el sistema.
 */

const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

const comoMalla = (v: unknown) => `#${v}`;

function Curva({
  puntos,
  campo,
  nombre,
  tope,
}: {
  puntos: PuntoDeLaCurva[];
  campo: "retenido" | "acumulado";
  nombre: string;
  /**
   * Techo mínimo del eje Y. Sin él, recharts lo ajusta a los datos. Es un piso
   * y no un valor fijo: si lo retenido supera la muestra el acumulado pasa de
   * 100, y recortar el eje escondería justo lo que hay que corregir.
   */
  tope?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={puntos} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis
          dataKey="malla"
          tickFormatter={comoMalla}
          tick={{ fontSize: 11, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          width={40}
          domain={[0, tope === undefined ? "auto" : (max: number) => Math.max(tope, Math.ceil(max))]}
          tickFormatter={(v) => `${num.format(Number(v))}%`}
        />
        <Tooltip
          labelFormatter={(v) => `Malla #${v}`}
          formatter={(v) => [`${num.format(Number(v))} %`, nombre]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Line
          type="monotone"
          dataKey={campo}
          name={nombre}
          stroke="#1E7D34"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Lo que quedó retenido en cada tamiz, en % del peso tamizado. */
export function CurvaDeRetenido({ puntos }: { puntos: PuntoDeLaCurva[] }) {
  return <Curva puntos={puntos} campo="retenido" nombre="Retenido" />;
}

/** El acumulado de cada tamiz: sube de 0 a 100 %, de ahí el techo en 100. */
export function CurvaDeAcumulado({ puntos }: { puntos: PuntoDeLaCurva[] }) {
  return <Curva puntos={puntos} campo="acumulado" nombre="Acumulado" tope={100} />;
}
