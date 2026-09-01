import * as XLSX from "xlsx";

function xlsxBufferResponse(filename: string, wb: XLSX.WorkBook): Response {
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** Arma un .xlsx a partir de filas (array de arrays) y lo devuelve como Response de descarga. */
export function xlsxResponse(filename: string, sheetName: string, rows: unknown[][]): Response {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return xlsxBufferResponse(filename, wb);
}

/**
 * Igual que `xlsxResponse` pero con una hoja por entrada de `sheets` (ej. una
 * por día de la semana).
 *
 * `anchos` es opcional y va en caracteres, una entrada por columna: sin eso una
 * descripción larga se ve como `#####` hasta que quien abre el archivo arrastra
 * la columna a mano.
 */
export function xlsxMultiSheetResponse(
  filename: string,
  sheets: { name: string; rows: unknown[][]; anchos?: number[] }[]
): Response {
  const wb = XLSX.utils.book_new();
  for (const { name, rows, anchos } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (anchos?.length) ws["!cols"] = anchos.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); // Excel limita el nombre de hoja a 31 caracteres
  }
  return xlsxBufferResponse(filename, wb);
}
