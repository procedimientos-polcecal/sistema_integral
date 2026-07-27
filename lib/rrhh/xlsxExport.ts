import * as XLSX from "xlsx";

/** Arma un .xlsx a partir de filas (array de arrays) y lo devuelve como Response de descarga. */
export function xlsxResponse(filename: string, sheetName: string, rows: unknown[][]): Response {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
