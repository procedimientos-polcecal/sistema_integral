"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FilaDeLaComparacion, SerieDeLaComparacion } from "@/lib/calidad/ensayos/comparacion";

/**
 * Los tres gráficos de la curva granulométrica, con una curva por muestra.
 *
 * Aparte de la pantalla para que entre con `next/dynamic`, como los de
 * `indicadores/GraficosEnsayos.tsx`: `recharts` son ~350 KB que no hace falta
 * bajar para ver los selectores. Los ejes y la grilla tienen los mismos colores
 * que ése para que las dos pantallas se vean de la misma familia.
 *
 * El eje X es la malla, **categórico**: los tamices quedan igualmente
 * espaciados, que es como se lee una granulometría en la planilla. No hay una
 * tabla de aberturas en milímetros en el sistema.
 *
 * **Con varias muestras el eje es la unión de las mallas que midieron, y una
 * línea que no llega a un extremo es a propósito**: esa muestra no midió esa
 * malla. Por eso `connectNulls={false}`, que es la única línea de este archivo
 * que sostiene la decisión entera — con `true`, recharts une los dos puntos
 * vecinos y dibuja un tramo que cruza por encima de una malla que nadie
 * tamizó, indistinguible de un dato. El porqué completo está en
 * `lib/calidad/ensayos/comparacion.ts`.
 *
 * Sin línea punteada con la curva previa a la exclusión y sin marca en el hueco
 * del tamiz apagado.
 */

const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

const comoMalla = (v: unknown) => `#${v}`;

/**
 * Lo que la leyenda muestra de cada etiqueta.
 *
 * La etiqueta puede traer una observación de hasta 40 caracteres, y seis de
 * ésas envuelven varias filas dentro de un panel de alto fijo (`h-64`): la
 * leyenda se come el dibujo, y en un teléfono lo tapa. El chip de arriba y el
 * tooltip siguen mostrándola entera.
 */
const LARGO_EN_LA_LEYENDA = 26;

const paraLaLeyenda = (v: unknown) => {
  const texto = String(v);
  return texto.length > LARGO_EN_LA_LEYENDA ? `${texto.slice(0, LARGO_EN_LA_LEYENDA)}…` : texto;
};

function Curva({
  filas,
  series,
  campo,
  nombre,
  etiquetasEnteras = false,
  tope,
  piso,
}: {
  filas: FilaDeLaComparacion[];
  series: SerieDeLaComparacion[];
  campo: "retenido" | "acumulado" | "pasante";
  /**
   * Sin cortar la etiqueta de la leyenda. Lo usa la vista ampliada, donde hay
   * ancho de sobra y la etiqueta entera es justo lo que se va a leer.
   */
  etiquetasEnteras?: boolean;
  /**
   * Cómo se llama la magnitud. Es lo que el tooltip usa **cuando hay una sola
   * muestra**: ahí la etiqueta sería la fecha, que ya está en el título del
   * panel, y el hover perdería lo único que aclaraba qué número se está
   * mirando. Con varias, el tooltip nombra la muestra, que es la pregunta.
   */
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
      <LineChart data={filas} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
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
          formatter={(v, nombre) => [`${num.format(Number(v))} %`, nombre]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        {/*
          Con una sola muestra la leyenda repetiría el título del panel y le
          comería alto al dibujo, que en el teléfono ya es poco.
        */}
        {series.length > 1 && (
          <Legend
            wrapperStyle={{ fontSize: etiquetasEnteras ? 12 : 11 }}
            formatter={etiquetasEnteras ? undefined : paraLaLeyenda}
          />
        )}
        {series.map((serie) => (
          <Line
            key={serie.id}
            type="monotone"
            dataKey={serie.claves[campo]}
            name={series.length > 1 ? serie.etiqueta : nombre}
            stroke={serie.color}
            strokeWidth={2}
            // El que de verdad separa las curvas fotocopiadas: ver
            // `TRAZOS_DE_LA_COMPARACION` en `lib/calidad/ensayos/comparacion.ts`.
            strokeDasharray={serie.trazo}
            dot={{ r: 3 }}
            // El hueco se dibuja como hueco: ver el encabezado del archivo.
            connectNulls={false}
            // Sin animación: el botón del Excel rasteriza el gráfico, y un clic
            // durante los ~1,5 s que tarda en dibujarse la línea la sacaría a medias.
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface PropsDeLosGraficos {
  filas: FilaDeLaComparacion[];
  series: SerieDeLaComparacion[];
  /** Ver `etiquetasEnteras` de `Curva`: lo pasa la vista ampliada. */
  etiquetasEnteras?: boolean;
}

/** Lo que quedó retenido en cada tamiz, en % del peso tamizado. */
export function CurvaDeRetenido({ filas, series, etiquetasEnteras }: PropsDeLosGraficos) {
  return (
    <Curva
      filas={filas}
      series={series}
      campo="retenido"
      nombre="Retenido"
      etiquetasEnteras={etiquetasEnteras}
    />
  );
}

/** El acumulado de cada tamiz: sube de 0 a 100 %, de ahí el techo en 100. */
export function CurvaDeAcumulado({ filas, series, etiquetasEnteras }: PropsDeLosGraficos) {
  return (
    <Curva
      filas={filas}
      series={series}
      campo="acumulado"
      nombre="Acumulado"
      etiquetasEnteras={etiquetasEnteras}
      tope={100}
    />
  );
}

/**
 * El pasante: lo que pasa por cada tamiz, 100 menos el acumulado. Baja de 100 a
 * 0 %. Lleva techo en 100 **y** piso en 0, los dos como mínimo y no como valor
 * fijo: un pasante negativo —lo retenido supera al peso— tiene que verse.
 */
export function CurvaDePasante({ filas, series, etiquetasEnteras }: PropsDeLosGraficos) {
  return (
    <Curva
      filas={filas}
      series={series}
      campo="pasante"
      nombre="Pasante"
      etiquetasEnteras={etiquetasEnteras}
      tope={100}
      piso={0}
    />
  );
}
