/**
 * Leer las planillas de mantenimiento.
 *
 * Lo que comparten los avisos y las órdenes de trabajo: las dos viven en
 * planillas de Google que se leen sin formato, y las dos identifican al equipo
 * por un código metido en un texto libre.
 */

/**
 * El texto de una celda, o null.
 *
 * Una celda con error de fórmula —"#REF!", "#N/A"— se lee como vacía: la
 * planilla tiene una que deja el mensaje de error en la celda de quién avisó,
 * y guardarlo sería guardar el error como si fuera un nombre.
 */
export const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  return /^#(REF|N\/A|VALUE|NAME|DIV\/0|NULL|NUM)/i.test(s) ? null : s;
};

/**
 * Una fecha de la planilla, que se lee sin formato.
 *
 * Llega como serial de Sheets —los días desde el 30/12/1899—. El respaldo en
 * texto lee d/m/aaaa, que es como escribe la gente acá: leerlo al revés fue lo
 * que dio vuelta 885 fechas en Compras.
 */
export function fechaDeSheets(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  const n = Number(valor);
  if (!isNaN(n) && n >= 1) {
    const ms = (Math.floor(n) - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const s = String(valor).trim();

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}

/**
 * El código del equipo dentro del texto que escribió quien avisó.
 *
 * En la planilla el equipo viene como texto libre —"PO-A1-01 Compresor A1",
 * "Compresor (PO-A1-01)"— y el código es lo que permite enlazarlo con el
 * equipo de verdad.
 */
export function codigoDeEquipo(texto: string | null | undefined): string | null {
  const s = String(texto ?? "");
  const m = s.match(/\b([A-Z]{2,}-[A-Z0-9]+-\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}
