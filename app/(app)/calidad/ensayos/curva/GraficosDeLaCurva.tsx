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
 * Los tres gráficos de la curva granulométrica de una muestra.
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
  piso,
}: {
  puntos: PuntoDeLaCurva[];
  campo: "retenido" | "acumulado" | "pasante";
  nombre: string;
  /**
   * Techo mínimo del eje Y. Sin él, recharts lo ajusta a los datos. Es un piso
   * y no un valor fijo: si lo retenido supera la muestra el acumulado pasa de
   * 100, y recortar el eje escondería justo lo que hay que corregir.
   */
  tope?: number;
  /**
   * El mismo criterio por abajo: el eje arranca en este valor **o más abajo si
   * un punto cae por debajo**. Lo usa el pasante, que es 100 menos el acumulado
   * y por eso da negativo cuando lo retenido supera al peso. Sin esto el eje
   * empezaría en 0 y ese punto quedaría fuera del dibujo.
   */
  piso?: number;
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
          domain={[
            piso === undefined ? 0 : (min: number) => Math.min(piso, Math.floor(min)),
            tope === undefined ? "auto" : (max: number) => Math.max(tope, Math.ceil(max)),
          ]}
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
          // Sin animación: el botón del Excel rasteriza el gráfico, y un clic
          // durante los ~1,5 s que tarda en dibujarse la línea la sacaría a medias.
          isAnimationActive={false}
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

/**
 * El pasante: lo que pasa por cada tamiz, 100 menos el acumulado. Baja de 100 a
 * 0 %. Lleva techo en 100 **y** piso en 0, los dos como mínimo y no como valor
 * fijo: un pasante negativo —lo retenido supera al peso— tiene que verse.
 */
export function CurvaDePasante({ puntos }: { puntos: PuntoDeLaCurva[] }) {
  return <Curva puntos={puntos} campo="pasante" nombre="Pasante" tope={100} piso={0} />;
}
