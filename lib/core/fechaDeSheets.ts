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

/* ── El otro sentido: escribir una fecha en una planilla ──
 *
 * Sheets cuenta los días desde el 30/12/1899, y `fechaDeSheets` lo deshace con
 * el mismo 25569 —los días entre esa fecha y el 1/1/1970—.
 *
 * Se escribe el serial y NO el texto, y es la decisión que importa de este
 * archivo: un "9/9/2026" lo interpreta la planilla según su locale, y leer al
 * revés d/m y m/d ya dio vuelta 885 fechas en Compras. La planilla del
 * formulario es `es_MX` hoy y puede no serlo mañana. Un número no se
 * interpreta.
 */
const DIAS_HASTA_1970 = 25569;
const MS_POR_DIA = 86_400_000;

/**
 * El desfase de la planilla: `America/Araguaina`, igual que Argentina y sin
 * horario de verano.
 *
 * Tiene nombre porque un `-3` pelado en una firma del núcleo no dice de qué
 * zona habla. `lib/core/fechas.ts` bautiza el mismo número como
 * `OFFSET_ARGENTINA_MS`; son la misma historia contada para otro uso.
 */
const DESFASE_PLANILLA_HORAS = -3;

/**
 * Un día (`2026-09-10`) como serial entero, o `null` si esa fecha no existe.
 *
 * **Una fecha imposible se descarta, no se corrige**, que es la regla que
 * `fechaDeTexto` de `lib/core/fechas.ts` dejó escrita en mayúsculas después del
 * incidente de las 885 fechas. El 30 de febrero no se convierte en 2 de marzo:
 * `Date.parse` lo rueda solo —y devuelve un serial perfectamente plausible,
 * corrido uno a tres días—, así que la comprobación es de ida y vuelta. Sin
 * eso, este archivo y `fechas.ts` contestaban distinto la misma pregunta.
 *
 * No lleva desfase de zona: un día sin hora no tiene huso, es una fecha de
 * calendario. El que sí lo lleva es `serialDelInstante`.
 */
export function serialDelDia(iso: string): number | null {
  const s = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const ms = Date.parse(`${s}T00:00:00Z`);
  if (isNaN(ms)) return null;
  // De ida y vuelta: el 30 de febrero rueda al 2 de marzo y acá se nota.
  if (new Date(ms).toISOString().slice(0, 10) !== s) return null;

  return ms / MS_POR_DIA + DIAS_HASTA_1970;
}

/**
 * Un instante como serial con la fracción del día.
 *
 * El desfase es el de la zona de la planilla y no el del servidor: en Vercel el
 * servidor está en UTC, y escribir la marca temporal en UTC pondría los pedidos
 * de la mañana tres horas más tarde de lo que pasaron.
 *
 * A diferencia de `serialDelDia`, no valida: un `Date` inválido devuelve `NaN`,
 * que en JSON viaja como `null` y termina en una celda vacía sin que nadie se
 * entere. Lo garantiza quien llama —hoy es un `created_at` de Postgres, que no
 * puede ser inválido—; si algún día lo llama algo que parsea texto, esto tiene
 * que devolver `number | null` como su vecina.
 */
export function serialDelInstante(
  cuando: Date,
  desfaseHoras = DESFASE_PLANILLA_HORAS
): number {
  const local = cuando.getTime() + desfaseHoras * 3600 * 1000;
  return local / MS_POR_DIA + DIAS_HASTA_1970;
}
