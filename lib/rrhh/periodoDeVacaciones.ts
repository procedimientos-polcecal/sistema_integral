import type { DatosDeAusencia } from "./altaDeAusencia";

/**
 * Las decisiones que convierten un período de vacaciones en una ausencia.
 *
 * POR QUÉ VIVEN ACÁ Y NO EN LA RUTA
 *
 * Las rutas de este repo no tienen tests, y éstas son las dos que, si salen
 * mal, no se notan del lado que las usa: una deja un período descontando días
 * del **año equivocado**, y la otra hace que una corrección legítima no se
 * pueda guardar. Las dos se leen bien estando mal.
 *
 * POR QUÉ UNA VACACIÓN ES UNA AUSENCIA
 *
 * `/disponibilidad` lee `ausencias` y nada más. Hasta el 16/11/2026 la pantalla
 * de RRHH → Vacaciones insertaba derecho en la tabla `vacaciones`, así que esos
 * períodos no existían para la disponibilidad, ni para la programación del
 * taller, ni para los tres reportes de ausentismo: eran **20 de 41**, y 4 de
 * ellos tocaban ese día o uno futuro, o sea que había gente de vacaciones que
 * la pantalla mostraba como presente. Ahora toda vacación entra por
 * `altaDeAusencia()`, y `sincronizarPeriodoVacaciones()` escribe la fila de
 * `vacaciones` desde la ausencia.
 *
 * El diseño está en
 * `docs/superpowers/specs/2026-11-16-vacaciones-en-disponibilidad-design.md`.
 *
 * Las fechas son ISO "YYYY-MM-DD" y se comparan como texto: ordenan igual que
 * como fecha y no meten husos horarios en el medio.
 */

export interface CuerpoDePeriodo {
  employeeId?: string;
  anioCorrespondiente?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  observaciones?: string | null;
  /** Llega de una pestaña vieja con el formulario anterior. Se ignora a propósito. */
  diasTomados?: number;
}

/**
 * El cuerpo de un período, como los datos de la ausencia que lo va a crear.
 *
 * `tipo` y `justificada` están fijos porque son lo que hace existir al período:
 * `sincronizarPeriodoVacaciones()` sólo escribe la fila de `vacaciones` si la
 * ausencia es `VACACIONES` **y** está justificada. Una vacación «sin
 * justificar» no es una cosa.
 *
 * EL AÑO NO SE INVENTA. Antes la ruta lo rellenaba con el año en curso cuando
 * no venía, y eso descuenta los días del balance equivocado sin decir nada.
 * Dejándolo en `undefined`, `altaDeAusencia()` contesta 400 («Para Vacaciones
 * hay que indicar a qué año corresponden los días»), que es lo correcto. Un
 * `NaN` cuenta como no haber venido: la ficha del empleado manda
 * `Number(nuevaVacacion.anioCorrespondiente)` y el campo vacío da `NaN`.
 */
export function datosDeAusenciaDeVacaciones(
  cuerpo: CuerpoDePeriodo,
  cargadoPorId: string,
): DatosDeAusencia {
  const anio = cuerpo.anioCorrespondiente;
  return {
    employeeId: cuerpo.employeeId as string,
    fechaDesde: cuerpo.fechaDesde as string,
    fechaHasta: cuerpo.fechaHasta as string,
    tipo: "VACACIONES",
    justificada: true,
    observaciones: cuerpo.observaciones ?? null,
    anioCorrespondiente: Number.isInteger(anio) ? anio : undefined,
    cargadoPorId,
  };
}

/**
 * Qué columnas de la **ausencia** toca un PUT parcial.
 *
 * Lo que no vino no se pisa: un `undefined` escrito en una columna la borraría.
 *
 * `anioCorrespondiente` NO está acá, y ésa es la razón de que esta función
 * exista aparte de `hayAlgoQueCambiar()`: el año vive en `vacaciones` y no en
 * `ausencias`, así que un PUT que cambia sólo el año no produce ninguna columna
 * de ausencia que tocar. Si la ruta decidiera «no hay nada que cambiar» con
 * esto, el año no se podría corregir nunca.
 *
 * `diasTomados` tampoco: desde el 16/11/2026 ese número sale siempre del
 * calendario (`diasEntre()` de `vacacionesDeAusencia.ts`, la misma cuenta que
 * hace la sincronización). Una pestaña vieja todavía lo manda, y se ignora.
 */
export function cambiosParaLaAusencia(cuerpo: CuerpoDePeriodo): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};
  if (cuerpo.employeeId !== undefined) cambios.empleado_id = cuerpo.employeeId;
  if (cuerpo.fechaDesde !== undefined) cambios.fecha_desde = cuerpo.fechaDesde;
  if (cuerpo.fechaHasta !== undefined) cambios.fecha_hasta = cuerpo.fechaHasta;
  if (cuerpo.observaciones !== undefined) cambios.observaciones = cuerpo.observaciones || null;
  return cambios;
}

/**
 * Si un PUT tiene algo que hacer.
 *
 * El «o» es todo el punto: hay cambios de ausencia **o** vino el año. Sin esto
 * la ruta tendría que elegir entre dos males —abortar una corrección de año
 * legítima, o escribir una fila de auditoría por un PUT vacío—, y la segunda es
 * peor de lo que parece: `auditoria` no tiene policy de update ni de delete y
 * un trigger las rechaza, así que cada fila que entra ahí es para siempre.
 */
export function hayAlgoQueCambiar(cuerpo: CuerpoDePeriodo): boolean {
  return (
    Object.keys(cambiosParaLaAusencia(cuerpo)).length > 0 || cuerpo.anioCorrespondiente !== undefined
  );
}

/**
 * Si el rango está dado vuelta.
 *
 * Nadie lo validaba: `diasEntre()` devolvía un negativo que terminaba en
 * `dias_tomados` y sumaba al balance en vez de restarle. Lo tapaba a medias el
 * `z.number().min(0)` del campo «Días», que desapareció junto con el campo.
 */
export function rangoAlReves(desde: string, hasta: string): boolean {
  return hasta < desde;
}
