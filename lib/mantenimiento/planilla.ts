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

/** Sin acentos, sin mayúsculas y sin espacios de más, para comparar textos. */
export const normalizar = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Un importe de la planilla.
 *
 * Sin formato llega como número. Pero la columna es de texto porque a veces
 * alguien escribe el precio en dólares —"U$D 286"— o con el formato argentino
 * puesto a mano, y eso no se puede perder: se rescata el número de adentro.
 */
export function monto(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return isFinite(valor) ? valor : null;

  const crudo = String(valor).replace(/[^\d,.-]/g, "");
  if (crudo === "") return null;

  // Con coma, es formato argentino: la coma decide los decimales y los puntos
  // son de miles. Sin coma, un punto solo es el decimal —así queda guardado un
  // número que pasó por String()— y varios sólo pueden ser de miles.
  const limpio = crudo.includes(",")
    ? crudo.replace(/\./g, "").replace(",", ".")
    : (crudo.match(/\./g) ?? []).length > 1
      ? crudo.replace(/\./g, "")
      : crudo;

  const n = Number(limpio);
  return isFinite(n) ? n : null;
}

/**
 * El IVA como fracción: 0.21.
 *
 * Sin formato la celda ya llega así. Leída con formato dice "21%", y tomarla
 * como número daría veintiún veces el precio.
 */
export function porcentaje(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return isFinite(valor) ? valor : null;

  const s = String(valor).trim();
  const n = Number(s.replace("%", "").replace(",", ".").trim());
  if (!isFinite(n)) return null;

  return s.includes("%") ? n / 100 : n;
}

/** Una marca de la planilla: el booleano crudo, o cómo se escribe a mano. */
export function siNo(valor: unknown): boolean {
  if (typeof valor === "boolean") return valor;
  const s = normalizar(valor);
  return s === "true" || s === "verdadero" || s === "si" || s === "x" || s === "1";
}
