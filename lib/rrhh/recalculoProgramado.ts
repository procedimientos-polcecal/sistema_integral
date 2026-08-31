import type { SupabaseClient } from "@supabase/supabase-js";
import { recalcularSectorPeriodo } from "./engine/recalcular";
import { addUtcDays, utcDateOnlyFrom } from "./dates";

/**
 * Cuántos días hacia atrás recalcula la corrida programada.
 *
 * Alcanza con una ventana móvil porque lo que cambia los números de un día son
 * sus insumos —fichadas, ausencias, vacaciones—, y cada uno de esos se
 * recalcula solo al guardarse. Lo que la ventana cubre es lo otro: que pase el
 * tiempo. Los días nuevos necesitan su fila aunque nadie haya tocado nada, si
 * no el dashboard no tiene qué mostrar de hoy.
 *
 * 45 días cubre con margen el mes en curso y el anterior, que es lo que miran
 * las pantallas de todos los días y el período que se liquida.
 */
export const DIAS_VENTANA_RECALCULO = 45;

/**
 * Recalcula el padrón activo sobre la ventana móvil, hasta hoy.
 *
 * Es lo que corre el cron y lo que se dispara cuando cambia algo que afecta a
 * todos (un feriado, un turno, la configuración de liquidación). Nunca pasa de
 * hoy: para un día que no ocurrió no hay fichadas, y el motor lo marcaría como
 * falta sin clasificar.
 */
export async function recalcularVentana(supabase: SupabaseClient): Promise<{
  empleados: number;
  desde: string;
  hasta: string;
  ms: number;
}> {
  const hasta = utcDateOnlyFrom(new Date());
  const desde = addUtcDays(hasta, -DIAS_VENTANA_RECALCULO);
  const inicio = Date.now();
  const empleados = await recalcularSectorPeriodo(supabase, null, desde, hasta);
  return {
    empleados,
    desde: desde.toISOString().slice(0, 10),
    hasta: hasta.toISOString().slice(0, 10),
    ms: Date.now() - inicio,
  };
}

/**
 * Recalcula un día puntual para todo el padrón. Se usa al dar de alta o de baja
 * un feriado: cambia el tipo de día de todos, pero de un solo día, así que no
 * hace falta barrer la ventana entera.
 */
export async function recalcularDia(supabase: SupabaseClient, fecha: string): Promise<number> {
  const dia = new Date(`${fecha.slice(0, 10)}T00:00:00Z`);
  return recalcularSectorPeriodo(supabase, null, dia, dia);
}

/**
 * Dispara un recálculo sin hacer esperar a quien guardó.
 *
 * Los cambios de turnos y de configuración de liquidación afectan a todo el
 * padrón: hacerlos sincrónicos convertiría un "Guardar" de dos campos en una
 * espera de varios segundos. Se lanza y se sigue; si la función se corta antes
 * de terminar, la corrida programada de la madrugada lo arregla.
 *
 * Nunca lanza: que falle el recálculo no puede voltear el guardado que sí
 * funcionó.
 */
export function recalcularVentanaEnSegundoPlano(supabase: SupabaseClient): void {
  void recalcularVentana(supabase).catch((e) => {
    console.error("Recálculo en segundo plano falló:", e);
  });
}
