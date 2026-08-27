/**
 * Qué órdenes de trabajo están atrasadas.
 *
 * Hay dos maneras de estarlo y las dos cuentan: que la planilla la haya marcado
 * `ATRASADO` a mano, o que se le haya pasado la fecha en que tenía que hacerse.
 * La primera la decide una persona; la segunda, el calendario.
 *
 * Lo que **no** cuenta: una orden realizada —aunque se haya hecho tarde, ya no
 * hay nada que hacer con ella— y una suspendida, que se paró a propósito y
 * avisarla todos los días es ruido.
 */

/** Lo mínimo para saber si una orden está atrasada. */
export interface Atrasable {
  estado?: string | null;
  proxima_fecha?: string | null;
}

/** Estados en los que la orden ya no espera nada de nadie. */
const CERRADAS = ["REALIZADO", "SUSPENDIDA"];

/** El día de hoy como `aaaa-mm-dd`, con las partes locales. */
export function hoyISO(fecha = new Date()): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** Si la orden está atrasada al día de hoy. */
export function estaAtrasada(orden: Atrasable, hoy: string): boolean {
  const estado = String(orden.estado ?? "").toUpperCase();
  if (CERRADAS.includes(estado)) return false;

  if (estado === "ATRASADO") return true;

  const fecha = String(orden.proxima_fecha ?? "").slice(0, 10);
  // Se comparan los textos: `aaaa-mm-dd` ordena igual que la fecha, y no hay
  // huso horario que pueda correr el día.
  return Boolean(fecha) && fecha < hoy;
}

/**
 * Hace cuántos días venció.
 *
 * `null` cuando la marcaron atrasada a mano y no dice desde cuándo: no se sabe,
 * y poner cero la haría parecer recién vencida.
 */
export function diasDeAtraso(orden: Atrasable, hoy: string): number | null {
  const fecha = String(orden.proxima_fecha ?? "").slice(0, 10);
  if (!fecha) return null;

  const dias = Math.round((fechaLocal(hoy) - fechaLocal(fecha)) / 86400000);
  return Math.max(0, dias);
}

/** Una fecha `aaaa-mm-dd` en milisegundos, sin que el huso corra el día. */
function fechaLocal(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).getTime();
}

/**
 * Las atrasadas, de la más vieja a la más nueva.
 *
 * Las que no dicen desde cuándo van al final: no se sabe qué tan urgentes son,
 * y primero conviene mirar lo que sí se puede medir.
 */
export function ordenarPorAtraso<T extends Atrasable>(ordenes: T[], hoy: string): T[] {
  return [...ordenes].sort((a, b) => {
    const da = diasDeAtraso(a, hoy);
    const db = diasDeAtraso(b, hoy);

    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return db - da;
  });
}

interface ParaResumir extends Atrasable {
  ot_number?: number | null;
  prioridad?: string | null;
  sector_raw?: string | null;
}

/**
 * El estado de las atrasadas, para el aviso.
 *
 * Se agrupa por sector porque es como se decide a quién mandar: las cuatro
 * atrasadas de Calcinación son un problema de Calcinación, no cuatro problemas
 * sueltos.
 */
export function resumirAtrasadas<T extends ParaResumir>(ordenes: T[], hoy: string) {
  const atrasadas = ordenarPorAtraso(ordenes.filter((o) => estaAtrasada(o, hoy)), hoy);

  const porSector = new Map<string, number>();
  for (const o of atrasadas) {
    const sector = o.sector_raw ?? "Sin sector";
    porSector.set(sector, (porSector.get(sector) ?? 0) + 1);
  }

  return {
    total: atrasadas.length,
    urgentes: atrasadas.filter((o) => String(o.prioridad ?? "").toUpperCase() === "ALTA").length,
    masVieja: atrasadas[0] ?? null,
    atrasadas,
    porSector: [...porSector.entries()]
      .map(([sector, cuantas]) => ({ sector, cuantas }))
      .sort((a, b) => b.cuantas - a.cuantas),
  };
}
