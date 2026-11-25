"use client";

import type { SerieDeLaComparacion } from "@/lib/calidad/ensayos/comparacion";

/**
 * Hasta dónde se lee una etiqueta en la leyenda de la grilla.
 *
 * La etiqueta puede traer una observación de hasta 40 caracteres, y varias de
 * ésas envuelven muchas filas debajo de un panel que en la grilla mide ~287 px.
 * El chip de arriba y el tooltip siguen mostrándola entera, y la vista ampliada
 * también.
 */
const LARGO_EN_LA_LEYENDA = 26;

/**
 * Quién es cada curva: su color, **su trazo** y su etiqueta.
 *
 * **No es el `<Legend>` de recharts, a propósito y desde el 25/11/2026.** Aquél
 * se dibuja adentro del área del `LineChart`, que acá mide `h-64` fijo: le
 * quita alto al dibujo, y sacado el tope de seis muestras —con ocho entradas o
 * más— lo dejaba en nada. Siendo markup propio, el gráfico conserva su alto
 * entero y la leyenda crece hacia abajo como lo que es.
 *
 * Va **debajo del gráfico pero dentro del panel**, porque el panel es lo que
 * `html2canvas` fotografía para el Excel y para la imagen que se baja: una foto
 * de seis curvas sin leyenda no se puede leer.
 *
 * Todo el estilo va en `style` y no en clases de Tailwind, por lo mismo que el
 * fondo del panel: lo que entra en la foto no puede depender de que una
 * utilidad llegue al rasterizado.
 *
 * La muestra lleva el trazo y no es un adorno: en una fotocopia el color no
 * separa —seis luminancias sobre blanco no pasan de ~1,2 de contraste entre
 * sí— y el trazo sí.
 */
export function LeyendaDeLaCurva({
  series,
  etiquetasEnteras = false,
}: {
  series: SerieDeLaComparacion[];
  /** Sin cortar la etiqueta. Lo usa la vista ampliada, donde hay ancho de sobra. */
  etiquetasEnteras?: boolean;
}) {
  // Con una sola muestra la leyenda repetiría el título del panel.
  if (series.length < 2) return null;

  return (
    <ul
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 12px",
        listStyle: "none",
        margin: "8px 0 0",
        padding: 0,
      }}
    >
      {series.map((serie) => {
        const texto =
          etiquetasEnteras || serie.etiqueta.length <= LARGO_EN_LA_LEYENDA
            ? serie.etiqueta
            : `${serie.etiqueta.slice(0, LARGO_EN_LA_LEYENDA)}…`;
        return (
          <li
            key={serie.id}
            title={serie.etiqueta}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: etiquetasEnteras ? 12 : 11,
              color: "#475569",
            }}
          >
            <svg width="22" height="8" aria-hidden style={{ flex: "0 0 auto" }}>
              <line
                x1="0"
                y1="4"
                x2="22"
                y2="4"
                stroke={serie.color}
                strokeWidth="2"
                strokeDasharray={serie.trazo}
              />
            </svg>
            {texto}
          </li>
        );
      })}
    </ul>
  );
}
