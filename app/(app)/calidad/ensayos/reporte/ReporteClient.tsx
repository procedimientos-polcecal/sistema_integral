"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  comoSeEscribe,
  fechaDelReporte,
  FILAS_DEL_REPORTE,
  type Reporte,
} from "@/lib/calidad/ensayos/reporte";

/**
 * El reporte del día, con la forma de la planilla que calidad ya reparte:
 * encabezados verdes, una columna por muestra y los acumulados resaltados.
 *
 * **El guión es un dato.** Donde dice `-` es que esa determinación no se midió,
 * y un cero ahí se leería como que dio cero — es la distinción que el archivo
 * de Excel perdía escribiéndola de seis formas distintas.
 *
 * Los estilos de la tabla van en `style` y no en clases de Tailwind: `html2pdf`
 * rasteriza el nodo con `html2canvas`, y los colores de fondo puestos por
 * utilidades a veces no llegan al PDF. Acá el fondo del encabezado es el dato
 * que distingue una fila de otra, así que no puede depender de eso.
 */

const VERDE_ENCABEZADO = "#C6E0B4";
const VERDE_DESTACADO = "#E2EFDA";

export default function ReporteClient({ reporte }: { reporte: Reporte }) {
  const router = useRouter();
  const tabla = useRef<HTMLDivElement>(null);
  const [generando, setGenerando] = useState(false);

  async function descargarPDF() {
    const el = tabla.current;
    if (!el) return;
    setGenerando(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `ensayos-${reporte.fecha}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          // Apaisado: con cinco muestras en un día la tabla no entra en vertical.
          jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .from(el)
        .save();
    } finally {
      setGenerando(false);
    }
  }

  const avisos = reporte.columnas.filter((c) => c.mallasQueNoEntran.length > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reporte del día</h1>
          <p className="text-sm text-slate-500">
            {reporte.columnas.length === 0
              ? "No hay muestras cargadas en esta fecha."
              : `${reporte.columnas.length} ${
                  reporte.columnas.length === 1 ? "muestra" : "muestras"
                }.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={reporte.fecha}
            onChange={(e) => router.push(`/calidad/ensayos/reporte?fecha=${e.target.value}`)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            onClick={descargarPDF}
            disabled={generando || reporte.columnas.length === 0}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {generando ? "Generando…" : "Descargar PDF"}
          </button>
        </div>
      </div>

      {reporte.columnas.length > 0 && (
        <>
          <div className="overflow-x-auto">
            {/* Lo que entra al PDF es este nodo y nada más. */}
            <div ref={tabla} style={{ background: "#FFFFFF", padding: 8 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 13,
                  fontFamily: "Calibri, Arial, sans-serif",
                  color: "#1E293B",
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        background: VERDE_ENCABEZADO,
                        border: "1px solid #FFFFFF",
                        padding: "6px 10px",
                        textAlign: "center",
                        fontWeight: 400,
                        minWidth: 170,
                      }}
                    >
                      {fechaDelReporte(reporte.fecha)}
                    </th>
                    {reporte.columnas.map((c) => (
                      <th
                        key={c.muestra_id}
                        style={{
                          border: "1px solid #FFFFFF",
                          background: "#FFFFFF",
                          padding: "6px 14px",
                          textAlign: "center",
                          fontWeight: 400,
                          minWidth: 110,
                        }}
                      >
                        {c.producto}
                        {/*
                          La observación es lo que distingue dos muestras del
                          mismo producto el mismo día —un despacho de la mañana
                          y uno de la tarde—, así que va en el encabezado y no
                          al pie.
                        */}
                        {c.detalle && (
                          <div style={{ fontSize: 11, color: "#64748B" }}>{c.detalle}</div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {FILAS_DEL_REPORTE.map((fila, i) => (
                    <tr key={fila.etiqueta}>
                      <td
                        style={{
                          background: fila.destacada ? VERDE_DESTACADO : VERDE_ENCABEZADO,
                          border: "1px solid #FFFFFF",
                          padding: "5px 10px",
                          textAlign: "center",
                        }}
                      >
                        {fila.etiqueta}
                      </td>
                      {reporte.columnas.map((c) => {
                        const celda = c.celdas[i];
                        return (
                          <td
                            key={c.muestra_id}
                            style={{
                              border: "1px solid #D9D9D9",
                              background: fila.destacada ? VERDE_DESTACADO : "#FFFFFF",
                              padding: "5px 10px",
                              textAlign: "center",
                              // Un desvío se ve también acá: el reporte es lo
                              // que mira quien no entra al sistema.
                              color: celda?.fuera ? "#B91C1C" : undefined,
                              fontWeight: celda?.fuera ? 600 : undefined,
                            }}
                          >
                            {comoSeEscribe(fila, celda)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {avisos.length > 0 && (
            <p className="text-xs text-slate-500">
              {avisos.map((c) => (
                <span key={c.muestra_id} className="block">
                  <strong>{c.producto}</strong> tamizó además{" "}
                  {c.mallasQueNoEntran.map((m) => `#${m}`).join(", ")}, que este formato no muestra —
                  está en el detalle de la muestra.
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </div>
  );
}
