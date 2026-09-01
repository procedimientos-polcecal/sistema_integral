/**
 * El día de calendario, visto desde Argentina.
 *
 * EL PROBLEMA
 *
 * `new Date().toISOString().slice(0, 10)` parece "hoy" y es "hoy en UTC".
 * Vercel corre en UTC, así que desde las **21:00 de Argentina** el servidor ya
 * cree que es mañana. Y en el navegador da igual de mal por el otro camino: el
 * reloj está en hora de Argentina, pero `toISOString()` convierte a UTC antes
 * de recortar.
 *
 * Había veinte lugares haciendo eso. El que más molesta es el remis: la pantalla
 * existe para mirar de noche a qué hora sale el de mañana, y a partir de las
 * nueve mostraba el día equivocado — justo en la franja en que se usa.
 *
 * LA CONVENCIÓN
 *
 * Argentina no tiene horario de verano desde 2009: UTC-3 fijo todo el año. El
 * desplazamiento se aplica a mano y no se delega al huso del runtime, igual que
 * en `lib/rrhh/dates.ts`, que ya lo explica para las horas de fichada. Así el
 * resultado no depende de en qué región quedó desplegada la función ni de la
 * computadora de quien mira.
 *
 * QUÉ **NO** ES ESTO
 *
 * No reemplaza a `lib/rrhh/dates.ts`. Ahí un "día calendario" se representa
 * como un `Date` a medianoche UTC y se lee con getters UTC, y el motor de
 * liquidación depende de esa forma de punta a punta. Esto trabaja con textos
 * "YYYY-MM-DD", que es la forma en que viajan las fechas por la API y en que
 * Postgres guarda una columna `date`. Los dos conviven: éste es para decidir
 * **qué día es hoy**, aquél para hacer cuentas con los días de una liquidación.
 */

/** Hora de Argentina = hora UTC − 3, sin horario de verano. */
const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;

/**
 * La fecha de calendario en Argentina de un instante, como "YYYY-MM-DD".
 *
 * El parámetro existe para poder probarla: en producción se llama sin nada.
 */
export function fechaEnArgentina(instante: Date = new Date()): string {
  return new Date(instante.getTime() - OFFSET_ARGENTINA_MS).toISOString().slice(0, 10);
}

/** Hoy en Argentina, como "YYYY-MM-DD". */
export function hoyEnArgentina(instante?: Date): string {
  return fechaEnArgentina(instante);
}

/**
 * Un día relativo a hoy en Argentina: `1` es mañana, `-1` ayer.
 *
 * Se corre sobre la fecha ya resuelta y no sobre el instante, así el resultado
 * es siempre el día siguiente del calendario. Hacerlo con `d.setDate(d.getDate()
 * + 1)` sobre un instante y recortar en UTC arrastra el mismo error de arriba.
 */
export function diaEnArgentina(dias: number, instante?: Date): string {
  return sumarDias(fechaEnArgentina(instante), dias);
}

/**
 * Suma días a una fecha "YYYY-MM-DD" y devuelve otra igual.
 *
 * La cuenta se hace en UTC a propósito: una fecha sin hora no tiene huso, y
 * pasarla por la hora local es cómo se pierde un día al cruzar el mes.
 */
export function sumarDias(iso: string, dias: number): string {
  const t = comoUtc(iso);
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

/** El día de la semana de una fecha "YYYY-MM-DD". 0 = domingo, 6 = sábado. */
export function diaDeLaSemana(iso: string): number {
  return comoUtc(iso).getUTCDay();
}

/**
 * Los siete días de la semana que contiene a `iso`, de lunes a domingo.
 *
 * Lunes primero porque es como se mira una semana de trabajo. `corrimiento` mueve
 * semanas enteras: `-1` es la anterior, `1` la siguiente.
 */
export function semanaDe(iso: string, corrimiento = 0): string[] {
  const dow = diaDeLaSemana(iso);
  // Domingo es 0 pero cierra la semana, así que retrocede seis y no cero.
  const lunes = sumarDias(iso, -(dow === 0 ? 6 : dow - 1) + corrimiento * 7);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/** Una fecha "YYYY-MM-DD" como la escribe una persona: 24/08/2026. */
export function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

function comoUtc(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, (m ?? 1) - 1, d ?? 1));
}

/**
 * Una fecha escrita a mano, a `"YYYY-MM-DD"`. `null` si no es una fecha.
 *
 * Acepta `d/m/aaaa` —como la escriben las planillas—, con separador `/` o `-`,
 * día y mes de uno o dos dígitos, año de dos o cuatro, y con hora de más
 * detrás. Y acepta la forma ISO por si alguna celda viene así.
 *
 * NO ADIVINA EL ORDEN. `05/13/2026` es día 5 de un mes 13, o sea imposible, y
 * devuelve `null` — no se da vuelta a m/d. Eso ya costó caro: el parser de
 * Compras suponía M/D y dio vuelta el día y el mes en el 39% de los
 * requerimientos, en todos los que tenían día 12 o menos. Lo delató la
 * secuencia de RI, que es correlativa: los 1795 a 1811, del 11 y 12 de agosto,
 * quedaron guardados como noviembre y diciembre, y el 1812 —del 13— quedó bien
 * porque 13 no puede ser un mes y ahí acertaba por descarte. Una planilla tiene
 * un solo locale para todas sus celdas: no hay mezcla que resolver.
 *
 * UNA FECHA IMPOSIBLE SE DESCARTA, NO SE CORRIGE. El 31 de febrero no se
 * convierte en 3 de marzo: `new Date` lo haría rodar solo y eso esconde el
 * problema en vez de mostrarlo. La comprobación es de ida y vuelta, en UTC para
 * que no dependa del huso del runtime.
 *
 * Había dos implementaciones de esto. La de `compras/sheets.ts` validaba los
 * rangos y tenía tests; la de `compras/comparativa.ts` no validaba nada, así
 * que `05/13/2026` salía como `"2026-13-05"` y hacía fallar el INSERT de la
 * comparativa entera por una celda.
 */
export function fechaDeTexto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;

  // ISO primero. No hay ambigüedad con d/m: un año de cuatro dígitos no entra
  // en el `\d{1,2}` del día.
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return armar(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Sin anclar el final: la celda suele traer la hora detrás.
  //
  // El año de cuatro dígitos va PRIMERO en la alternancia. La regex prueba de
  // izquierda a derecha y se queda con lo primero que entra, así que con
  // `(\d{2}|\d{4})` el "2026" matcheaba como año de dos dígitos —"20"— y
  // 12/08/2026 salía 2020-08-12.
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})/);
  if (dmy) {
    const anio = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return armar(anio, Number(dmy[2]), Number(dmy[1]));
  }

  return null;
}

/** Arma la fecha sólo si existe de verdad en el calendario. */
function armar(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  // De ida y vuelta: el 31 de febrero rueda al 3 de marzo y acá se nota.
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    d.getUTCFullYear() !== anio ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    return null;
  }

  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
