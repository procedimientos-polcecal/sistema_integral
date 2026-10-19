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
      <style>{`
        @page { size: A4 portrait; margin: 10mm 12mm; }
        /* Lo que esconde el armazón —el header, el aside y las dos barras—
           vive en app/globals.css, no acá. Enumerarlo por pantalla es lo que
           dejó esta hoja saliendo con la barra de búsqueda encima el día que
           el layout ganó un header. */
        @media print {
          .no-print { display: none !important; }
          .print-content { padding: 0 !important; margin: 0 !important; }
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

        /* LOS TAMAÑOS DE LA HOJA, JUNTOS. Es lo único que hay que tocar si
           hay que agrandarla más — antes estaban repartidos en catorce
           atributos style en línea, y subir uno sin los otros desbalanceaba
           la hoja.
           Van en px y no en pt porque la hoja se mide en px para que
           html2pdf la capture 1:1 contra los 190mm de ancho útil. */
        .ot-page {
          --ot-rotulo: 13px;   /* ESPECIALIDAD, SECTOR, DESCRIPCIÓN… */
          --ot-dato:   16px;   /* lo que se lee: el sector, el equipo, la fecha */
          --ot-cuerpo: 18px;   /* la descripción y los repuestos, que es lo que
                                  alguien lee parado al lado de una máquina */
        }

        /* Un rótulo se lee como rótulo: en versales, sobre un fondo que lo
           separa del dato. Es lo que hace que la hoja se recorra de un
           vistazo en vez de leerse entera. */
        .ot-rotulo {
          font-weight: 700;
          font-size: var(--ot-rotulo);
          color: #B45309;
          background: #FFFBEB;
          text-align: center;
          vertical-align: middle;
          letter-spacing: .4px;
          line-height: 1.25;
          padding-left: 4px;
          padding-right: 4px;
        }
        /* Los rótulos largos no llevan interletrado: DESCRIPCIÓN y REPUESTOS
           UTILIZADOS son los dos más anchos de la hoja y con él tocaban los
           bordes de su columna. */
        .cell-label.ot-rotulo, .cell-real.ot-rotulo {
          letter-spacing: 0;
        }
        /* Centrado, como en un formulario de papel: cada dato en el medio
           de su casillero. No alcanza a la descripción ni a los repuestos,
           que son prosa y van en .ot-cuerpo — un párrafo centrado se lee
           peor, y además ese recuadro se completa a mano. */
        .ot-dato   { font-size: var(--ot-dato); vertical-align: middle; text-align: center; }
        .ot-cuerpo { font-size: var(--ot-cuerpo); line-height: 1.55; }
        .ot-resaltado { color: #B45309; font-weight: 600; }

        .ot-table {
          width: 100%;
          border-collapse: collapse;
          font-family: Arial, Helvetica, sans-serif;
          font-size: var(--ot-dato);
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
        .cell-ot-lbl { width: 62px; flex-shrink: 0; }
        .cell-ot-num { width: 80px; flex-shrink: 0; }
        /* Las dos filas de datos comparten columnas para que la grilla
           cierre: ESPECIALIDAD sobre SECTOR y FECHA sobre EQUIPO. Antes la
           de arriba era UNA sola celda con los textos adentro y la de abajo
           cuatro celdas, así que nada alineaba. */
        /* 118px es el ancho de la columna de rótulos de TODA la hoja:
           ESPECIALIDAD, SECTOR, DESCRIPCIÓN, REPUESTOS y FECHA DE EJECUCIÓN
           caen una debajo de otra. Es lo que la hace leer como una grilla y
           no como cinco filas que se parecen. */
        .cell-rot-izq { width: 118px; flex-shrink: 0; }
        .cell-rot-der { width: 96px; flex-shrink: 0; }
        .cell-val     { flex: 1; min-width: 0; }
        .cell-label  { width: 118px; flex-shrink: 0; }
        .cell-content { flex: 1; overflow: hidden; }
        .cell-fec-lbl { width: 118px; flex-shrink: 0; }
        .cell-fec-val { flex: 1; }
        .cell-real    { width: 152px; flex-shrink: 0; }
        .cell-firma   { width: 120px; flex-shrink: 0; }
      `}</style>

      <div className="print-content py-8 px-4">
        {/* En el flujo y no flotando. Estaban en `fixed top-4 right-4`, que
            las dibujaba **encima del header de la app** —tapaban la campana y
            el nombre de quien mira—, porque `fixed` se posiciona contra la
            ventana y no contra el área que scrollea.

            `sticky top-0` da lo mismo que daba `fixed` —siguen a la vista al
            bajar por una tanda de OT— sin el choque: se pegan al tope del
            `<main>`, que empieza justo debajo del header. Y no lleva un alto
            de header escrito a mano, que es lo que se rompe el día que el
            header cambie de alto. */}
          <div className="no-print sticky top-0 z-10 -mx-4 mb-6 flex justify-end gap-2 bg-[#f1f5f9] px-4 py-3">
          <button onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-slate-700 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Imprimir
          </button>
          <button onClick={savePDF} disabled={generating}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 shadow-lg hover:bg-amber-600 disabled:opacity-50 transition-colors">
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
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50 transition-colors">
            Cerrar
          </button>
        </div>

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
                      <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 2 }}>ORDEN DE TRABAJO</span>
                    </td>
                    <td className="cell-ot-lbl ot-rotulo" style={{ padding: "6px" }}>
                      N° OT
                    </td>
                    <td className="cell-ot-num"
                      style={{ textAlign: "center", verticalAlign: "middle", padding: "6px", fontWeight: 900, fontSize: 24 }}>
                      {item.ot_number}
                    </td>
                  </tr>

                  <tr className="row-esp">
                    <td className="cell-rot-izq ot-rotulo" style={{ padding: "8px" }}>
                      ESPECIALIDAD
                    </td>
                    <td className="cell-val ot-dato ot-resaltado" style={{ padding: "8px" }}>
                      {item.especialidad ?? "—"}
                    </td>
                    <td className="cell-rot-der ot-rotulo" style={{ padding: "8px" }}>
                      FECHA
                    </td>
                    <td className="cell-val ot-dato" style={{ padding: "8px" }}>
                      {fechaStr}
                    </td>
                  </tr>

                  <tr className="row-sector">
                    <td className="cell-rot-izq ot-rotulo" style={{ padding: "8px" }}>
                      SECTOR
                    </td>
                    <td className="cell-val ot-dato ot-resaltado" style={{ padding: "8px 12px" }}>
                      {item.sector_raw ?? "—"}
                    </td>
                    <td className="cell-rot-der ot-rotulo" style={{ padding: "8px" }}>
                      EQUIPO
                    </td>
                    <td className="cell-val ot-dato ot-resaltado" style={{ padding: "8px" }}>
                      {item.equipo_raw ?? "—"}
                    </td>
                  </tr>

                  <tr className="row-desc">
                    <td className="cell-label ot-rotulo" style={{ padding: "8px" }}>
                      DESCRIPCIÓN
                    </td>
                    <td colSpan={3} className="cell-content"
                      style={{ padding: "12px 16px", verticalAlign: "top" }}>
                      <div className="ot-cuerpo">{item.descripcion ?? ""}</div>
                      {item.notas_item && (
                        <div style={{ marginTop: 12, fontSize: "var(--ot-dato)", color: "#555", fontStyle: "italic", borderTop: "1px dashed #ccc", paddingTop: 10 }}>
                          Nota: {item.notas_item}
                        </div>
                      )}
                    </td>
                  </tr>

                  <tr className="row-rep">
                    <td className="cell-label ot-rotulo" style={{ padding: "8px" }}>
                      REPUESTOS<br />UTILIZADOS
                    </td>
                    <td colSpan={3} className="cell-content ot-cuerpo"
                      style={{ padding: "12px 16px", verticalAlign: "top" }}>
                      {item.repuesto ?? ""}
                    </td>
                  </tr>

                  <tr className="row-fecha">
                    <td className="cell-fec-lbl ot-rotulo" style={{ padding: "10px 6px" }}>
                      FECHA DE<br />EJECUCIÓN
                    </td>
                    <td className="cell-fec-val ot-dato" style={{ padding: "10px 12px" }}>
                      {fechaEjec}
                    </td>
                    <td className="cell-real ot-rotulo" style={{ padding: "10px 6px" }}>
                      REALIZADO / ATRASADO
                    </td>
                    <td className="cell-firma ot-rotulo"
                      style={{ padding: "10px", background: "none", textAlign: "left" }}>
                      FIRMA
                      {assignee && (
                        <div style={{ fontSize: "var(--ot-dato)", fontWeight: 400, color: "#444", marginTop: 6 }}>
                          {assignee}
                        </div>
                      )}
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
