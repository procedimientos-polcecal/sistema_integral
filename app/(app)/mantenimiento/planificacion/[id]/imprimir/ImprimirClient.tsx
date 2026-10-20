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
        /* Los rótulos largos no llevan interletrado: DESCRIPCIÓN, REPUESTOS
           UTILIZADOS y REALIZADO / ATRASADO son los más anchos de la hoja y
           con él tocaban los bordes de su columna.
           Apunta a las dos columnas de rótulos enteras y no a tres clases
           sueltas: las clases por celda se fueron el 20/10/2026 al unificar la
           grilla, y una regla que nombra clases que ya no existen no avisa —
           simplemente deja de aplicarse. */
        .col-1.ot-rotulo, .col-3.ot-rotulo {
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
        /*
         * LAS CUATRO COLUMNAS DE LA HOJA, DEFINIDAS UNA SOLA VEZ.
         *
         * Antes cada fila declaraba sus anchos —"cell-logo" 56px, "cell-real"
         * 152px, "cell-val" con "flex: 1"— y por eso ninguna divisoria caía
         * sobre la de arriba. Medido el 20/10/2026 sobre la hoja renderizada:
         * la línea del logo en x=201 contra x=263 en todas las demás filas, y
         * la de FECHA en 515, la de EQUIPO en 519 y la de REALIZADO en 591.
         *
         * **"flex: 1" no sirve para columnas que tienen que alinear**: su
         * "flex-basis: 0" se mide sobre la caja de contenido, así que la celda
         * con "padding: 8px 12px" termina 4px más ancha que la de "8px" aunque
         * las dos digan "flex: 1". Ésos eran los 4px entre FECHA y EQUIPO.
         *
         * Van en porcentaje y no en px porque la hoja mide 190mm en pantalla y
         * 100% al imprimir: con anchos fijos la grilla cerraría en una y no en
         * la otra. Y van con "flex: 0 0 ancho" —ni crecen ni se encogen— más
         * el "box-sizing: border-box" de arriba, que es lo que mete el padding
         * adentro del ancho en vez de sumárselo.
         *
         * Si hay que cambiar una, se cambia acá y la hoja entera sigue
         * cerrando. Las cuatro suman 100.
         */
        .col-1    { flex: 0 0 17%; }   /* ESPECIALIDAD, SECTOR, DESCRIPCIÓN… */
        .col-2    { flex: 0 0 38%; min-width: 0; }
        .col-3    { flex: 0 0 15%; }   /* FECHA, EQUIPO, REALIZADO / ATRASADO */
        .col-4    { flex: 0 0 30%; min-width: 0; }
        /* Las filas que no parten la derecha: DESCRIPCIÓN y REPUESTOS. */
        .col-2-3-4 { flex: 0 0 83%; min-width: 0; overflow: hidden; }

        /*
         * El encabezado tiene su propio reparto, y es a propósito.
         *
         * Su primera celda sí es col-1 —el logo cae sobre la columna de
         * rótulos, que es lo que lo hacía salir corrido— pero las otras tres no
         * comparten las divisorias de abajo: en el papel el título ocupa casi
         * todo el ancho y el N° va en dos cajas chicas a la derecha, más
         * angostas que las columnas de FECHA y EQUIPO.
         *
         * Forzarlo al mismo reparto se probó y parte "ORDEN DE TRABAJO" en dos
         * renglones: 38% de la hoja no alcanza para 28px con interletrado.
         */
        .hdr-titulo { flex: 1 1 auto; min-width: 0; }
        .hdr-rotulo { flex: 0 0 10%; }
        .hdr-numero { flex: 0 0 13%; }
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
                    <td className="col-1"
                      style={{ verticalAlign: "middle", textAlign: "center", padding: 6 }}>
                      <img src="/logo.png" alt="Logo" style={{ width: 44, height: 44, objectFit: "contain" }} />
                    </td>
                    <td className="hdr-titulo"
                      style={{ textAlign: "center", verticalAlign: "middle", padding: "8px 12px" }}>
                      <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 2 }}>ORDEN DE TRABAJO</span>
                    </td>
                    <td className="hdr-rotulo ot-rotulo" style={{ padding: "6px" }}>
                      N° OT
                    </td>
                    <td className="hdr-numero"
                      style={{ textAlign: "center", verticalAlign: "middle", padding: "6px", fontWeight: 900, fontSize: 24 }}>
                      {item.ot_number}
                    </td>
                  </tr>

                  <tr className="row-esp">
                    <td className="col-1 ot-rotulo" style={{ padding: "8px" }}>
                      ESPECIALIDAD
                    </td>
                    <td className="col-2 ot-dato ot-resaltado" style={{ padding: "8px" }}>
                      {item.especialidad ?? "—"}
                    </td>
                    <td className="col-3 ot-rotulo" style={{ padding: "8px" }}>
                      FECHA
                    </td>
                    <td className="col-4 ot-dato" style={{ padding: "8px" }}>
                      {fechaStr}
                    </td>
                  </tr>

                  <tr className="row-sector">
                    <td className="col-1 ot-rotulo" style={{ padding: "8px" }}>
                      SECTOR
                    </td>
                    <td className="col-2 ot-dato ot-resaltado" style={{ padding: "8px 12px" }}>
                      {item.sector_raw ?? "—"}
                    </td>
                    <td className="col-3 ot-rotulo" style={{ padding: "8px" }}>
                      EQUIPO
                    </td>
                    <td className="col-4 ot-dato ot-resaltado" style={{ padding: "8px" }}>
                      {item.equipo_raw ?? "—"}
                    </td>
                  </tr>

                  <tr className="row-desc">
                    <td className="col-1 ot-rotulo" style={{ padding: "8px" }}>
                      DESCRIPCIÓN
                    </td>
                    <td colSpan={3} className="col-2-3-4"
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
                    <td className="col-1 ot-rotulo" style={{ padding: "8px" }}>
                      REPUESTOS<br />UTILIZADOS
                    </td>
                    <td colSpan={3} className="col-2-3-4 ot-cuerpo"
                      style={{ padding: "12px 16px", verticalAlign: "top" }}>
                      {item.repuesto ?? ""}
                    </td>
                  </tr>

                  <tr className="row-fecha">
                    <td className="col-1 ot-rotulo" style={{ padding: "10px 6px" }}>
                      FECHA DE<br />EJECUCIÓN
                    </td>
                    <td className="col-2 ot-dato" style={{ padding: "10px 12px" }}>
                      {fechaEjec}
                    </td>
                    <td className="col-3 ot-rotulo" style={{ padding: "10px 6px" }}>
                      REALIZADO / ATRASADO
                    </td>
                    <td className="col-4 ot-rotulo"
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
