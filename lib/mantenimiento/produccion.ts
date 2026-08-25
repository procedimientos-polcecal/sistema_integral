/**
 * Planificación de producción, semana por semana y sector por sector.
 *
 * Por cada semana y sector se guarda el estado de los siete días. Sirve para
 * ver dónde queda lugar y meter ahí las reparaciones, en vez de frenar el
 * despacho para arreglar algo.
 */

export const ESTADOS_PRODUCCION = ["EN_PRODUCCION", "PARCIAL", "LIBRE"] as const;
export type EstadoProduccion = (typeof ESTADOS_PRODUCCION)[number];

export const ESTADO_LABELS: Record<EstadoProduccion, { label: string; color: string; bg: string }> = {
  EN_PRODUCCION: { label: "En producción", color: "#166534", bg: "#DCFCE7" },
  PARCIAL: { label: "Parcial", color: "#92400E", bg: "#FEF3C7" },
  LIBRE: { label: "Libre", color: "#475569", bg: "#F1F5F9" },
};

export const TURNOS = [
  { valor: "M", label: "Mañana" },
  { valor: "T", label: "Tarde" },
  { valor: "N", label: "Noche" },
] as const;

export const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

/** Una fecha como `aaaa-mm-dd`, leyendo sus partes locales. */
function iso(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * El lunes de la semana de una fecha.
 *
 * Se arma con las partes locales y no con `toISOString()`: esa convierte a UTC,
 * y la medianoche local de un huso positivo cae el día anterior, con lo que la
 * semana entera se corre. Vercel corre en UTC y las pantallas en Argentina, así
 * que la diferencia no es teórica.
 */
export function lunesDe(fecha: Date): string {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  // getDay() da 0 el domingo; se rota para que el lunes sea 0.
  const desdeLunes = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - desdeLunes);
  return iso(d);
}

/** Los siete días de la semana que arranca ese lunes. */
export function diasDeLaSemana(lunes: string): string[] {
  const [a, m, d] = lunes.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => iso(new Date(a, m - 1, d + i)));
}

/**
 * Siete valores, siempre.
 *
 * Lo que llega de la pantalla puede venir corto, largo o con un valor que ya no
 * existe. Guardar un arreglo de otro largo rompería la grilla al leerla.
 */
export function normalizarSemana<T extends string>(
  valores: unknown,
  validos: readonly T[],
  porDefecto: T
): T[] {
  const arr = Array.isArray(valores) ? valores : [];
  return Array.from({ length: 7 }, (_, i) => {
    const v = arr[i];
    return validos.includes(v as T) ? (v as T) : porDefecto;
  });
}

/** Siete textos libres —motivos, turnos—, recortados o completados. */
export function normalizarTextos(valores: unknown): string[] {
  const arr = Array.isArray(valores) ? valores : [];
  return Array.from({ length: 7 }, (_, i) => String(arr[i] ?? "").trim());
}

/**
 * Qué días de la semana no produce ningún sector.
 *
 * Un día está libre sólo si lo está en todos: alcanza con que un sector
 * produzca para que ese día no sirva para una parada general.
 */
export function diasLibres(registros: { days?: unknown }[]): boolean[] {
  return Array.from({ length: 7 }, (_, i) =>
    registros.every((r) => {
      const dias = Array.isArray(r.days) ? r.days : [];
      return (dias[i] ?? "LIBRE") === "LIBRE";
    })
  );
}
