"use client";

import { useRef, useState } from "react";
import { LEYENDA_TURNO_DE_NOCHE, type FilaDeMarcaciones, type TotalesDeMarcaciones } from "@/lib/rrhh/marcacionesDelMes";

/**
 * La hoja de marcaciones de un empleado, para imprimir o guardar en PDF.
 *
 * Dos cosas que no se deducen del código:
 *
 * - **Los estilos de la tabla van en `style` y no en clases de Tailwind.**
 *   `html2pdf` rasteriza el nodo con `html2canvas`, y los fondos puestos por
 *   utilidades a veces no llegan al PDF. Acá el fondo del encabezado y el de
 *   la fila de totales son lo que separa una cosa de la otra, así que no
 *   pueden depender de eso. Es la misma razón que en el reporte de Ensayos.
 * - **No se imprime sola al abrirse**, a diferencia de la hoja de ruta de
 *   Remises. Esto no es un formulario que se llena en papel: lo normal es
 *   guardarlo como archivo, así que el botón que se ve primero es ése.
 *
 * El ancho de la hoja es 190 mm —A4 menos 10 mm de margen por lado— para que
 * `html2pdf` la capture 1:1 y no reescale la letra.
 */
export default function ImprimirClient({
  titulo,
  encabezado,
  filas,
  totales,
  archivo,
}: {
  titulo: string;
  encabezado: [string, string][];
  filas: FilaDeMarcaciones[];
  totales: TotalesDeMarcaciones;
  archivo: string;
}) {
  const contenido = useRef<HTMLDivElement>(null);
  const [generando, setGenerando] = useState(false);

  async function descargarPDF() {
    const el = contenido.current;
    if (!el) return;
    setGenerando(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: archivo,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          // Un mes largo pasa de una página: que el corte no parta un renglón
          // por la mitad.
          pagebreak: { mode: ["css", "legacy"], avoid: "tr" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .from(el)
        .save();
    } finally {
      setGenerando(false);
    }
  }

  const celda = { border: "1px solid #CBD5E1", padding: "4px 6px" } as const;

  return (
    <>
      <div className="no-print fixed top-4 right-4 z-10 flex gap-2">
        <button
          onClick={descargarPDF}
          disabled={generando}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-slate-700 disabled:opacity-50"
        >
          {generando ? "Generando PDF..." : "Guardar PDF"}
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50"
        >
          Imprimir
        </button>
        <button
          onClick={() => window.close()}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50"
        >
          Cerrar
        </button>
      </div>

      <style>{`
        @page { size: A4 portrait; margin: 14mm; }
        @media print { .no-print { display: none !important; } body { margin: 0 !important; } }
        body { background: #f1f5f9; font-family: Arial, Helvetica, sans-serif; }
        .mc-page { width: 190mm; margin: 24px auto; background: white; border: 1px solid #ccc; padding: 14mm; box-sizing: border-box; }
        @media print { .mc-page { width: 100%; margin: 0; border: none; padding: 0; } }
      `}</style>

      <div ref={contenido} className="mc-page">
        <h1 style={{ fontSize: 19, fontWeight: 700, marginBottom: 2, color: "#0F172A" }}>Marcaciones</h1>
        <p style={{ fontSize: 14, color: "#334155", marginBottom: 14 }}>{titulo}</p>

        <table style={{ marginBottom: 16, fontSize: 12, color: "#334155" }}>
          <tbody>
            {encabezado.map(([etiqueta, valor]) => (
              <tr key={etiqueta}>
                <td style={{ fontWeight: 700, paddingRight: 14, verticalAlign: "top" }}>{etiqueta}</td>
                <td>{valor}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {filas.length === 0 ? (
          <p style={{ fontSize: 13, color: "#64748B" }}>No hay marcaciones en el período.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, color: "#0F172A" }}>
            <thead>
              <tr style={{ background: "#E2E8F0" }}>
                <th style={{ ...celda, textAlign: "left" }}>Fecha</th>
                <th style={{ ...celda, textAlign: "left" }}>Día</th>
                <th style={{ ...celda, textAlign: "left" }}>Marcaciones</th>
                <th style={{ ...celda, textAlign: "right" }}>Hs.</th>
                <th style={{ ...celda, textAlign: "right" }}>Ex. 50%</th>
                <th style={{ ...celda, textAlign: "right" }}>Ex. 100%</th>
                <th style={{ ...celda, textAlign: "left" }}>Día</th>
                <th style={{ ...celda, textAlign: "left" }}>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.fecha}>
                  <td style={{ ...celda, whiteSpace: "nowrap" }}>{f.fecha}</td>
                  <td style={celda}>{f.dia}</td>
                  <td style={celda}>{f.marcaciones}</td>
                  <td style={{ ...celda, textAlign: "right" }}>{f.horas.toFixed(1)}</td>
                  <td style={{ ...celda, textAlign: "right" }}>{f.extra50 > 0 ? f.extra50.toFixed(1) : "-"}</td>
                  <td style={{ ...celda, textAlign: "right" }}>{f.extra100 > 0 ? f.extra100.toFixed(1) : "-"}</td>
                  <td style={celda}>{f.tipoDia}</td>
                  <td style={celda}>{f.observaciones}</td>
                </tr>
              ))}
              <tr style={{ background: "#E2E8F0", fontWeight: 700 }}>
                <td style={celda}>TOTAL</td>
                <td style={{ ...celda, whiteSpace: "nowrap" }} colSpan={2}>
                  {totales.dias} {totales.dias === 1 ? "día" : "días"}
                </td>
                <td style={{ ...celda, textAlign: "right" }}>{totales.horas.toFixed(1)}</td>
                <td style={{ ...celda, textAlign: "right" }}>{totales.extra50 > 0 ? totales.extra50.toFixed(1) : "-"}</td>
                <td style={{ ...celda, textAlign: "right" }}>{totales.extra100 > 0 ? totales.extra100.toFixed(1) : "-"}</td>
                <td style={celda}></td>
                <td style={celda}></td>
              </tr>
            </tbody>
          </table>
        )}

        <p style={{ fontSize: 10, color: "#64748B", marginTop: 10 }}>{LEYENDA_TURNO_DE_NOCHE}</p>
      </div>
    </>
  );
}
