import { diaDeLaSemana } from "@/lib/core/fechas";

/**
 * El último día anterior a `hoy` que sea hábil y tenga fichadas importadas.
 *
 * Es el día que mira la tarjeta de RRHH del Inicio, y las condiciones
 * salen de medir contra producción el 06/10/2026, no de suponer:
 *
 *   - **Hoy no sirve.** A media mañana `calculos_diarios` tenía 2 filas de 68:
 *     el día no está cerrado. Por eso la tarjeta decía "1 ausente" mientras el
 *     día anterior había 66.
 *   - **El domingo no cuenta.** De los 36 domingos que ya pasaron en 2026, los
 *     36 tienen exactamente 0 ausentes sobre 68 empleados. Un lunes, "ayer" diría 0 y no
 *     informaría nada. Y no alcanza con pedir que el día tenga fichadas: un
 *     domingo tiene entre 4 y 20, de gente que sí trabaja.
 *   - **El feriado tampoco.** De los 11 feriados de 2026 con datos, 9 tienen 0
 *     ausentes; los otros dos tienen 2 y 4. Promedio 0,5 contra 42,3 en días
 *     hábiles (medido el 06/10/2026).
 *   - **El sábado SÍ cuenta**: entre 3 y 9 ausentes todos los sábados. "Día
 *     hábil" acá es *no domingo y no feriado*, no la semana de lunes a viernes.
 *
 * Y la condición que más importa: **el día tiene que tener fichadas**. La
 * importación anda a ráfagas: en 2026 sólo entraron fichadas en julio, agosto
 * y septiembre —unas 1.550 por mes—. De febrero a junio no entró ninguna
 * (salvo 3 sueltas el 30/06, la primera prueba), y desde el 01/10 tampoco.
 * En los meses sin fichadas `calculos_diarios` llena igual las 68 filas y
 * marca a todos ausentes: el promedio de un día hábil pasa de 7 a 65. Sin
 * esta condición la tarjeta mostraría hoy 66 de 68, que es ruido del feed y
 * no un dato de RRHH.
 *
 * Riesgo asumido: un día con fichadas parciales califica igual. Si una
 * importación trae 8 de 68, ese día pasa y la tarjeta mostraría ~60 ausentes
 * falsos. No se pone umbral de completitud porque un domingo tiene entre 4 y 20
 * fichadas legítimas y no hay forma medida de distinguir las dos cosas.
 *
 * @param fechasConFichadas fechas "YYYY-MM-DD" que tienen al menos una fichada.
 *   Puede venir con repetidos y sin ordenar. **Quien llame tiene que garantizar
 *   que la lista incluya las fechas más recientes**: la función devuelve el
 *   máximo de lo que le pasan y no tiene cómo saber que le llegó una lista
 *   truncada (PostgREST corta en 1000 filas sin avisar; ver `diaDeReferenciaRrhh`
 *   en `lib/home/consultas.ts`, que las pide de la más nueva a la más vieja).
 * @param feriados fechas "YYYY-MM-DD" de la tabla `feriados` del núcleo.
 * @param hoy "YYYY-MM-DD" en Argentina (`hoyEnArgentina()`).
 */
export function ultimoDiaHabilConFichadas(
  fechasConFichadas: string[],
  feriados: string[],
  hoy: string
): string | null {
  const esFeriado = new Set(feriados);
  const candidatos = fechasConFichadas.filter(
    (f) => f < hoy && diaDeLaSemana(f) !== 0 && !esFeriado.has(f)
  );
  if (candidatos.length === 0) return null;
  // Las fechas ISO ordenan igual como texto que como fecha.
  return candidatos.reduce((a, b) => (b > a ? b : a));
}
