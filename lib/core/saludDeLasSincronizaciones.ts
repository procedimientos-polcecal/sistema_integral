/**
 * Cuándo un recurso de sincronización está caído, y desde hace cuánto.
 *
 * Es `estadoDelPaso` de `lib/agenda/avisosDeLaAgenda.ts` sacado de la Agenda:
 * lo único que cambia es que la tolerancia llega por parámetro y no como la
 * constante `HORAS_SIN_CORRER`, porque cada recurso corre a su propio ritmo —un
 * cron diario no se mide con la vara de uno que corre cada 15 minutos—. Son
 * funciones puras: leer `ultima_sincronizacion` es de quien las llama.
 */

/** Lo que `ultima_sincronizacion` dice de la última corrida de un recurso. */
export interface CorridaLeida {
  modulo: string;
  recurso: string;
  ok: boolean;
  /** Lo que dijo el recurso al fallar, sin traducir. */
  error: string | null;
  created_at: string;
}

/** Cómo está un recurso. `sana` es la única que no es un problema. */
export type EstadoDeRecurso = "nunca" | "fallo" | "vieja" | "sana";

/**
 * **Tres cosas dejan caído a un recurso**, y la tercera es la que justifica que
 * esto exista:
 *
 *  1. La última corrida **falló** (`ok = false`): el recurso ya lo anotó, con lo
 *     que dijo del otro lado. Gana sobre la edad: un fallo de hace cuatro días
 *     se nombra por el fallo, que es lo que hay que arreglar, y no por «vieja».
 *  2. La última corrida es **vieja**: el recurso no corrió. **No deja ninguna
 *     fila de fallo** —si no corre, no escribe—, así que mirar sólo `ok` lo vería
 *     verde para siempre. Es el canal muerto que no se distingue de uno sano.
 *  3. **Nunca corrió**: no hay fila. Una sincronización que jamás corrió no está
 *     sana, aunque tampoco haya fallado.
 *
 * Una fecha ilegible cuenta como `vieja` y no como `sana`: no se puede afirmar
 * que corrió hace un rato con un dato que no se entiende, y equivocarse para el
 * lado de «todo bien» es justo lo que esta función existe para no hacer.
 */
export function estadoDeRecurso(
  corrida: CorridaLeida | undefined,
  toleranciaHoras: number,
  ahora: Date
): EstadoDeRecurso {
  if (!corrida) return "nunca";
  if (!corrida.ok) return "fallo";
  const cuando = new Date(corrida.created_at).getTime();
  const corte = ahora.getTime() - toleranciaHoras * 3_600_000;
  return Number.isNaN(cuando) || cuando < corte ? "vieja" : "sana";
}

/**
 * La cantidad con la que un recurso caído entra a la campana y al resumen.
 *
 * **Su número no cuenta cosas.** No son recursos ni canales ni filas: son las
 * **tolerancias enteras** que lleva sin correr, y existe sólo para que
 * descartar el aviso no lo silencie para siempre. Es la misma nota de
 * `cantidadDelAviso` en `lib/home/ritmo.ts`: `filtrarDescartadas` vuelve a
 * mostrar un aviso cuando su cantidad superó a la que tenía al descartarlo,
 * así que un número fijo dejaría mudo a un recurso que sigue caído semanas, y
 * uno que crece solo cada noche haría inútil descartarlo. Contar tolerancias da
 * el punto medio: descartarlo a las 25 h (1) lo calla hasta las 48 h (2).
 *
 * Es al menos 1 en cualquier caso caído, porque un aviso con cantidad 0 no
 * existe: cubre el fallo reciente (la corrida es de hace una hora, 0
 * tolerancias de silencio, pero el recurso está caído), el recurso que nunca
 * corrió y la fecha ilegible —en esos dos últimos no hay desde cuándo contar,
 * y quedan en 1 fijo, igual que «nunca se cargó» en `cantidadDelAviso`—.
 */
export function cuantasTolerancias(
  corrida: CorridaLeida | undefined,
  toleranciaHoras: number,
  ahora: Date
): number {
  if (!corrida) return 1;
  const cuando = new Date(corrida.created_at).getTime();
  if (Number.isNaN(cuando)) return 1;
  const horasDeSilencio = (ahora.getTime() - cuando) / 3_600_000;
  return Math.max(1, Math.floor(horasDeSilencio / toleranciaHoras));
}
