"use client";

import { useEffect, useRef, useState } from "react";

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function ImprimirClient({ hoja, asientos }: { hoja: any; asientos: any[] }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const label = hoja.tipo === "ida" ? "IDA (Búsqueda)" : "VUELTA (Retorno)";

  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);

  async function savePDF() {
    const el = contentRef.current;
    if (!el) return;
    setGenerating(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `hoja-ruta-${hoja.vehiculos?.nombre ?? hoja.id}-${hoja.fecha}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        } as any)
        .from(el)
        .save();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <div className="no-print fixed top-4 right-4 z-10 flex gap-2">
        <button onClick={() => window.print()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-gray-700">
          Imprimir
        </button>
        <button onClick={savePDF} disabled={generating} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 shadow-lg hover:bg-amber-600 disabled:opacity-50">
          {generating ? "Generando PDF..." : "Guardar PDF"}
        </button>
        <button onClick={() => window.close()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-lg hover:bg-gray-50">
          Cerrar
        </button>
      </div>

      <style>{`
        @page { size: A4 portrait; margin: 14mm; }
        @media print { .no-print { display: none !important; } body { margin: 0 !important; } }
        body { background: #f1f5f9; font-family: Arial, Helvetica, sans-serif; }
        .hr-page { width: 190mm; margin: 24px auto; background: white; border: 1px solid #ccc; padding: 16mm; box-sizing: border-box; }
        @media print { .hr-page { width: 100%; margin: 0; border: none; padding: 0; } }
      `}</style>

      <div ref={contentRef} className="hr-page">
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Hoja de Ruta — {label}</h1>
        <p style={{ fontSize: 13, color: "#555", marginBottom: 16 }}>
          {fmtFecha(hoja.fecha)} · {hoja.remises_turnos?.nombre}
          {hoja.hora_salida ? ` · Salida ${hoja.hora_salida}` : ""}
        </p>

        <table style={{ width: "100%", marginBottom: 20, fontSize: 13 }}>
          <tbody>
            <tr><td style={{ fontWeight: 700, width: 120 }}>Vehículo</td><td>{hoja.vehiculos?.nombre}</td></tr>
            {hoja.choferes?.nombre && <tr><td style={{ fontWeight: 700 }}>Conductor</td><td>{hoja.choferes.nombre}</td></tr>}
            {hoja.choferes?.telefono && <tr><td style={{ fontWeight: 700 }}>Teléfono</td><td>{hoja.choferes.telefono}</td></tr>}
            {hoja.km != null && <tr><td style={{ fontWeight: 700 }}>Distancia</td><td>{hoja.km} km · ~{hoja.minutos} min</td></tr>}
          </tbody>
        </table>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #999", padding: 6, width: 40 }}>#</th>
              <th style={{ border: "1px solid #999", padding: 6, textAlign: "left" }}>Empleado</th>
              <th style={{ border: "1px solid #999", padding: 6, textAlign: "left" }}>Dirección</th>
            </tr>
          </thead>
          <tbody>
            {asientos.map((a, si) => (
              <tr key={si}>
                <td style={{ border: "1px solid #999", padding: 6, textAlign: "center", fontWeight: 700 }}>{si + 1}</td>
                <td style={{ border: "1px solid #999", padding: 6 }}>{a.empleados?.apellido}, {a.empleados?.nombre}</td>
                <td style={{ border: "1px solid #999", padding: 6 }}>{a.empleados?.remises_empleados_datos?.direccion ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
