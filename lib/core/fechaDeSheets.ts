/**
 * La fecha que devuelve una planilla, sea serial o texto.
 *
 * Estaba en `lib/mantenimiento/planilla.ts` y la importaba Inventario desde
 * ahí. Producción es el tercero: por la regla de `docs/NUCLEO-COMPARTIDO.md`,
 * a la tercera se muda al núcleo con sus tests.
 *
 * **El texto se lee d/m y nunca m/d.** Leerlo al revés dio vuelta 885 fechas en
 * Compras, y es un error que no rompe nada: el dato simplemente queda mal.
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
 * El otro sentido: una fecha como la guarda Sheets.
 *
 * Sheets cuenta los días desde el 30/12/1899, y `fechaDeSheets` lo deshace con
 * el mismo 25569 —los días entre esa fecha y el 1/1/1970—.
 *
 * Se escribe el serial y no el texto **a propósito**: un "9/9/2026" lo
 * interpreta la planilla según su locale, que es `es_MX` en la del formulario y
 * podría no serlo mañana. Un número no se interpreta. Es la misma precaución
 * que la lectura ya tomaba al pedir `UNFORMATTED_VALUE`.
 */
const DIAS_HASTA_1970 = 25569;
const MS_POR_DIA = 86_400_000;

/** Un día (`2026-09-10`) como serial entero. `null` si no es una fecha ISO. */
export function serialDelDia(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? "").trim())) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (isNaN(ms)) return null;
  return ms / MS_POR_DIA + DIAS_HASTA_1970;
}

/**
 * Un instante como serial con la fracción del día.
 *
 * El desfase es el de la zona de la planilla y no el del servidor: en Vercel el
 * servidor está en UTC, y escribir la marca temporal en UTC pondría los pedidos
 * de la mañana tres horas más tarde de lo que pasaron.
 */
export function serialDelInstante(cuando: Date, desfaseHoras = -3): number {
  const local = cuando.getTime() + desfaseHoras * 3600 * 1000;
  return local / MS_POR_DIA + DIAS_HASTA_1970;
}
