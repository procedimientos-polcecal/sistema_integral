import { fechaEnArgentina } from "@/lib/core/fechas";
import { fechaParaElCalendario } from "@/lib/agenda/evento";
import { esGutAlto, type NotasGut } from "./gut";

/**
 * Qué órdenes de trabajo están atrasadas.
 *
 * Hay dos maneras de estarlo y las dos cuentan: que la planilla la haya marcado
 * `ATRASADO` a mano, o que se le haya pasado la fecha en que tenía que hacerse.
 * La primera la decide una persona; la segunda, el calendario.
 *
 * **La fecha es la de la ejecución y no `proxima_fecha`.** Esa columna está en
 * null en las 2.531 filas (medido el 19/11/2026; una foto y no un
 * invariante: al cierre de la rama eran 2.532, 19 marcadas y 32 atrasadas): la sincronización la lee de la
 * planilla —es la pareja de `frecuencia` en el master— pero nadie la llena, así
 * que decidir con ella reducía esta función a `estado === "ATRASADO"` y contaba
 * 21 donde las fechas dicen 34 (cifras de esa primera foto). Se sigue sincronizando; sólo se dejó de usar
 * para decidir.
 *
 * El inicio es el que ve el calendario (`fechaParaElCalendario`: la pendiente
 * si hay, si no la de la planilla) y el vencimiento es `fecha_fin` cuando es
 * posterior al inicio: una orden que arrancó ayer y termina mañana está en
 * curso. Una `fecha_fin` anterior al inicio es un dato sucio y vale «dura un
 * día», no adelanta el vencimiento.
 *
 * Lo que **no** cuenta: una orden realizada —aunque se haya hecho tarde, ya no
 * hay nada que hacer con ella— y una cancelada, que no se va a hacer nunca y
 * avisarla todos los días es ruido.
 */

/** Lo mínimo para saber si una orden está atrasada. */
export interface Atrasable {
  estado?: string | null;
  fecha_ejecucion?: string | null;
  fecha_ejecucion_pendiente?: string | null;
  fecha_fin?: string | null;
}

/**
 * Estados en los que la orden ya no espera nada de nadie.
 *
 * Tiene una gemela, `CERRADAS_GUT` en `gut.ts`, con los mismos dos valores y
 * **otro dueño**: aquella espeja la migración de `gut_orden` y ésta no espeja
 * nada, sólo decide qué cuenta como atrasada. No se unifican a propósito. Si un
 * día aparece un estado nuevo, hay que mirar las dos y decidir en cada una.
 * Se exporta para que quien consulta la base arme su `.not("estado", "in", ...)`
 * con la misma lista que usa la decisión.
 */
export const CERRADAS: readonly string[] = ["REALIZADO", "CANCELADA"];

/**
 * El día de hoy como `aaaa-mm-dd`, en hora de Argentina.
 *
 * Estaba escrito con getters locales —`getFullYear`, `getMonth`, `getDate`—
 * justamente para escapar de `toISOString()`, que convierte a UTC y corre el
 * día. Pero **no escapaba de nada**: en Vercel la hora local ES la UTC, así que
 * en el servidor daba exactamente lo mismo que la versión que quería reemplazar.
 * Desde las 21:00 de Argentina devolvía mañana, y un mantenimiento de hoy
 * aparecía vencido.
 *
 * Ahora sale del núcleo, que aplica el UTC-3 a mano y da igual en el servidor
 * que en el navegador de quien mira.
 */
export const hoyISO = fechaEnArgentina;

/** El día en que la orden arranca para el calendario, recortado a `aaaa-mm-dd`. */
function inicioDe(orden: Atrasable): string {
  const inicio = fechaParaElCalendario({
    fecha_ejecucion: orden.fecha_ejecucion ?? null,
    fecha_ejecucion_pendiente: orden.fecha_ejecucion_pendiente,
  });
  return (inicio ?? "").slice(0, 10);
}

/** Si la orden está atrasada al día de hoy. */
export function estaAtrasada(orden: Atrasable, hoy: string): boolean {
  const estado = String(orden.estado ?? "").toUpperCase();
  if (CERRADAS.includes(estado)) return false;

  if (estado === "ATRASADO") return true;

  const inicio = inicioDe(orden);
  if (!inicio) return false;

  const fechaFin = String(orden.fecha_fin ?? "").slice(0, 10);
  const fin = fechaFin && fechaFin > inicio ? fechaFin : inicio;
  // Se comparan los textos: `aaaa-mm-dd` ordena igual que la fecha, y no hay
  // huso horario que pueda correr el día.
  return fin < hoy;
}

/**
 * Hace cuántos días venció, contado desde el inicio efectivo.
 *
 * `null` cuando la marcaron atrasada a mano y no dice desde cuándo: no se sabe,
 * y poner cero la haría parecer recién vencida.
 */
export function diasDeAtraso(orden: Atrasable, hoy: string): number | null {
  const fecha = inicioDe(orden);
  if (!fecha) return null;

  const dias = Math.round((fechaLocal(hoy) - fechaLocal(fecha)) / 86400000);
  return Math.max(0, dias);
}

/**
 * La misma decisión de `estaAtrasada`, escrita como filtro `.or()` de PostgREST
 * para traer de la base sólo las atrasadas. Verificada contra producción el
 * 19/11/2026: devuelve las mismas 34 órdenes que la versión en TypeScript.
 *
 * Se aplica junto con `.not("estado", "in", ...CERRADAS)`. El caso sucio
 * `fecha_fin <= inicio` no se escribe a propósito: junto con `inicio < hoy` ya
 * implica `fecha_fin < hoy`, y la rama `or(fecha_fin.is.null, fecha_fin.lt.hoy)`
 * lo cubre.
 *
 * **Supone `estado` not null**, y es la última divergencia entre las dos
 * escrituras: `estaAtrasada` trata un estado null como «no cerrada» y sigue a
 * las fechas, pero `.not("estado","in",...)` evalúa `NOT (NULL IN (...))` →
 * NULL y descarta la fila. Hoy no muerde: hay 0 filas con `estado` null
 * (medido el 19/11/2026).
 */
export function condicionDeAtrasada(hoy: string): string {
  const sinVentana = `or(fecha_fin.is.null,fecha_fin.lt.${hoy})`;
  return [
    "estado.eq.ATRASADO",
    `and(fecha_ejecucion_pendiente.not.is.null,fecha_ejecucion_pendiente.lt.${hoy},${sinVentana})`,
    `and(fecha_ejecucion_pendiente.is.null,fecha_ejecucion.lt.${hoy},${sinVentana})`,
  ].join(",");
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

interface ParaResumir extends Atrasable, NotasGut {
  ot_number?: number | null;
  sector_raw?: string | null;
}

/**
 * El estado de las atrasadas, para el aviso.
 *
 * Se agrupa por sector porque es como se decide a quién mandar: las cuatro
 * atrasadas de Calcinación son un problema de Calcinación, no cuatro problemas
 * sueltos.
 *
 * `urgentes` son las atrasadas de **puntaje GUT alto** (65 o más), y no las de
 * `prioridad` "alta". Esa comparación —`prioridad.toUpperCase() === "ALTA"`—
 * **nunca coincidió**: la planilla guarda "🟠 Alta", con el emoji y el espacio,
 * así que el tablero decía "0 de prioridad alta" desde el primer día. No se
 * restaura: la prioridad de la planilla ya no decide nada, sólo se muestra.
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
    urgentes: atrasadas.filter(esGutAlto).length,
    masVieja: atrasadas[0] ?? null,
    atrasadas,
    porSector: [...porSector.entries()]
      .map(([sector, cuantas]) => ({ sector, cuantas }))
      .sort((a, b) => b.cuantas - a.cuantas),
  };
}
