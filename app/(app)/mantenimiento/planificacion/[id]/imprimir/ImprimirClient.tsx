"use client";

import { useEffect, useRef, useState } from "react";

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim();
}

export default function ImprimirClient({ plan, items }: { plan: any; items: any[] }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const planDate = new Date(plan.fecha + "T12:00:00");
  const fechaStr = planDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);

  async function savePDF() {
    const el = contentRef.current;
    if (!el) return;
    setGenerating(true);
    el.classList.add("pdf-exporting");
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `OT_Plan_${plan.fecha}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css"], before: ".pdf-page-break" },
        } as any)
        .from(el)
        .save();
    } finally {
      el.classList.remove("pdf-exporting");
      setGenerating(false);
    }
  }

  return (
    <>
      {/* Controls — hidden on print */}
      <div className="no-print fixed top-4 right-4 z-10 flex gap-2">
        <button onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-gray-700 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Imprimir
        </button>
        <button onClick={savePDF} disabled={generating}
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 shadow-lg hover:bg-amber-600 disabled:opacity-50 transition-colors">
          {generating ? (
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          )}
          {generating ? "Generando PDF..." : "Guardar PDF"}
        </button>
        <button onClick={() => window.close()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-lg hover:bg-gray-50 transition-colors">
          Cerrar
        </button>
      </div>

      <style>{`
        @page { size: A4 portrait; margin: 10mm 12mm; }
        @media print {
          .no-print { display: none !important; }
          aside, .sidebar, .mobile-topbar, nav { display: none !important; }
          main, [class*="main"], body > div { margin: 0 !important; padding: 0 !important; }
          .print-content { padding: 0 !important; margin: 0 !important; }
          body { background: white !important; margin: 0 !important; }
          .ot-page { page-break-after: always; page-break-inside: avoid; }
          .ot-page:last-child { page-break-after: avoid; }
        }
        body { background: #f1f5f9; font-family: Arial, Helvetica, sans-serif; }

        /* A4 = 210×297mm. Con margen 10mm en los 4 lados el área útil es
           190×277mm. La .ot-page usa ese ancho (190mm) para que html2pdf la
           capture a escala 1:1, y 268mm de alto (9mm de holgura) para que no
           quede una tira sobrante ("sliver") en una 2da página. */
        .ot-page {
          width: 190mm;
          height: 268mm;
          margin: 0 auto 16mm;
          background: white;
          border: 1px solid #ccc;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        @media print {
          .ot-page { width: 100%; height: 270mm; margin: 0; border: none; }
        }
        /* Durante la exportación a PDF: sin margen entre OTs (el page-break se
           encarga del salto) para no generar hojas casi en blanco. */
        .pdf-exporting .ot-page { margin: 0 !important; }

        .ot-table {
          width: 100%;
          border-collapse: collapse;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 11px;
          flex: 1;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .ot-table tbody {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .row-header  { flex: 0 0 auto; }
        .row-esp     { flex: 0 0 auto; }
        .row-sector  { flex: 0 0 auto; }
        .row-desc    { flex: 4; }
        .row-rep     { flex: 3; }
        .row-fecha   { flex: 0 0 auto; }

        .ot-table tr, .ot-table .ot-tr {
          display: flex;
          width: 100%;
        }
        .ot-table td {
          border: 1.5px solid #222;
          box-sizing: border-box;
        }
        .cell-logo   { width: 56px; flex-shrink: 0; }
        .cell-title  { flex: 1; }
        .cell-ot-lbl { width: 52px; flex-shrink: 0; }
        .cell-ot-num { width: 64px; flex-shrink: 0; }
        .cell-esp    { flex: 1; }
        .cell-fecha-val { width: 116px; flex-shrink: 0; }
        .cell-sector-lbl { width: 80px; flex-shrink: 0; }
        .cell-sector-val { flex: 1; }
        .cell-equipo-lbl { width: 72px; flex-shrink: 0; }
        .cell-equipo-val { flex: 1; }
        .cell-label  { width: 80px; flex-shrink: 0; }
        .cell-content { flex: 1; overflow: hidden; }
        .cell-fec-lbl { width: 80px; flex-shrink: 0; }
        .cell-fec-val { flex: 1; }
        .cell-real    { width: 120px; flex-shrink: 0; }
        .cell-firma   { width: 100px; flex-shrink: 0; }
      `}</style>

      <div className="print-content py-8 px-4">
        <div ref={contentRef} className="pdf-root">
        {items.map((item, idx) => {
          const assignee = nombreCompleto(item.assigned_user) || item.assigned_name || "";
          const fechaEjec = item.fecha_ejecucion
            ? new Date(item.fecha_ejecucion + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
            : fechaStr;

          return (
            <div key={item.id} className={`ot-page${idx > 0 ? " pdf-page-break" : ""}`}>
              <table className="ot-table" style={{ tableLayout: "fixed" }}>
                <tbody>
                  <tr className="row-header">
                    <td className="cell-logo" rowSpan={2}
                      style={{ verticalAlign: "middle", textAlign: "center", padding: 6 }}>
                      <img src="/logo.png" alt="Logo" style={{ width: 44, height: 44, objectFit: "contain" }} />
                    </td>
                    <td className="cell-title"
                      style={{ textAlign: "center", verticalAlign: "middle", padding: "8px 12px" }}>
                      <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: 2 }}>ORDEN DE TRABAJO</span>
                    </td>
                    <td className="cell-ot-lbl"
                      style={{ textAlign: "center", verticalAlign: "bottom", padding: "4px 6px", fontWeight: 700, fontSize: 10 }}>
                      N° OT
                    </td>
                    <td className="cell-ot-num"
                      style={{ textAlign: "center", verticalAlign: "middle", padding: "4px 6px", fontWeight: 900, fontSize: 16 }}>
                      {item.ot_number}
                    </td>
                  </tr>

                  <tr className="row-esp">
                    <td className="cell-esp" style={{ padding: "5px 12px", verticalAlign: "middle" }}>
                      <span style={{ fontWeight: 700, marginRight: 8, fontSize: 10 }}>ESPECIALIDAD</span>
                      <span style={{ color: "#D97706", fontWeight: 600 }}>{item.especialidad ?? "—"}</span>
                      <span style={{ fontWeight: 700, marginLeft: 24, marginRight: 8, fontSize: 10 }}>FECHA</span>
                      <span>{fechaStr}</span>
                    </td>
                    <td colSpan={2} className="cell-fecha-val"
                      style={{ textAlign: "center", verticalAlign: "middle", padding: "5px 8px" }}>
                      {fechaEjec}
                    </td>
                  </tr>

                  <tr className="row-sector">
                    <td className="cell-sector-lbl"
                      style={{ textAlign: "center", verticalAlign: "middle", fontWeight: 700, fontSize: 10, padding: "6px 8px" }}>
                      SECTOR
                    </td>
                    <td className="cell-sector-val"
                      style={{ padding: "6px 12px", verticalAlign: "middle", color: "#D97706", fontWeight: 600 }}>
                      {item.sector_raw ?? "—"}
                    </td>
                    <td className="cell-equipo-lbl"
                      style={{ textAlign: "center", verticalAlign: "middle", fontWeight: 700, fontSize: 10, padding: "6px 8px" }}>
                      EQUIPO
                    </td>
                    <td className="cell-equipo-val"
                      style={{ padding: "6px 8px", verticalAlign: "middle", color: "#D97706", fontWeight: 600 }}>
                      {item.equipo_raw ?? "—"}
                    </td>
                  </tr>

                  <tr className="row-desc">
                    <td className="cell-label"
                      style={{ textAlign: "center", verticalAlign: "middle", fontWeight: 700, fontSize: 10, padding: "6px 8px", color: "#D97706" }}>
                      DESCRIPCIÓN
                    </td>
                    <td colSpan={3} className="cell-content"
                      style={{ padding: "10px 14px", verticalAlign: "top" }}>
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>{item.descripcion ?? ""}</div>
                      {item.notas_item && (
                        <div style={{ marginTop: 10, fontSize: 10, color: "#555", fontStyle: "italic", borderTop: "1px dashed #ccc", paddingTop: 8 }}>
                          Nota: {item.notas_item}
                        </div>
                      )}
                    </td>
                  </tr>

                  <tr className="row-rep">
                    <td className="cell-label"
                      style={{ textAlign: "center", verticalAlign: "middle", fontWeight: 700, fontSize: 10, padding: "6px 8px", color: "#D97706" }}>
                      REPUESTOS<br />UTILIZADOS
                    </td>
                    <td colSpan={3} className="cell-content"
                      style={{ padding: "10px 14px", verticalAlign: "top", fontSize: 12 }}>
                      {item.repuesto ?? ""}
                    </td>
                  </tr>

                  <tr className="row-fecha">
                    <td className="cell-fec-lbl"
                      style={{ textAlign: "center", verticalAlign: "middle", fontWeight: 700, fontSize: 9, padding: "8px 6px", color: "#D97706" }}>
                      FECHA DE<br />EJECUCIÓN
                    </td>
                    <td className="cell-fec-val"
                      style={{ padding: "8px 12px", verticalAlign: "middle", fontSize: 12 }}>
                      {fechaEjec}
                    </td>
                    <td className="cell-real"
                      style={{ textAlign: "center", verticalAlign: "middle", fontWeight: 700, fontSize: 10, padding: "8px 6px", color: "#D97706" }}>
                      REALIZADO / ATRASADO
                    </td>
                    <td className="cell-firma"
                      style={{ padding: "8px 10px", verticalAlign: "middle" }}>
                      <div style={{ fontWeight: 700, fontSize: 10, color: "#D97706" }}>FIRMA</div>
                      {assignee && <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>{assignee}</div>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
        </div>
      </div>
    </>
  );
}
