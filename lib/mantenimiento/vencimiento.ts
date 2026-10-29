/**
 * Cuándo le toca a un mantenimiento programado, y cuándo le toca después.
 *
 * Esto vivía adentro de `app/api/mantenimiento/ejecuciones/route.ts` como un
 * `calcNextDate` privado, y se saca acá por la regla del repo —la lógica que
 * decide algo va a `lib/` para poder probarla— pero sobre todo porque ahora la
 * llaman dos: la ruta que registra una ejecución y el paso que genera las OT
 * periódicas solo. Dos copias de «cada cuánto se repite esto» es cómo un
 * mantenimiento termina venciendo distinto según quién lo mire.
 */

import { sumarDias } from "@/lib/core/fechas";

/** Lo que hace falta de un programado para saber cuándo vence. */
export interface Vencimiento {
  schedule_type: string;
  interval_days: number | null;
  next_date: string | null;
}

/**
 * Cada cuántos días se repite cada tipo.
 *
 * Son los mismos valores que tenía `calcNextDate`, copiados tal cual: MENSUAL
 * es 30 días y no «el mismo número del mes que viene», y cambiarlo ahora
 * movería el único programado que existe.
 */
const CADA_CUANTO: Record<string, number> = {
  DIARIO: 1, SEMANAL: 7, QUINCENAL: 15, MENSUAL: 30,
  TRIMESTRAL: 90, SEMESTRAL: 180, ANUAL: 365,
};

/** Si ya llegó el día de este programado. El mismo día cuenta. */
export function leToca(v: Vencimiento, hoy: string): boolean {
  return v.next_date !== null && v.next_date <= hoy;
}

/**
 * La próxima vez que toca, o `null` si no hay próxima.
 *
 * ── SALTEA LOS CICLOS PERDIDOS, Y ÉSA ES LA DECISIÓN ────────────────────────
 *
 * Sumar el intervalo **una** vez —lo que hacía `calcNextDate`— deja vencido lo
 * que estaba vencido hace rato. El único programado que existe venció el
 * 8/8/2026 y es mensual: al 29/10 lleva tres ciclos perdidos, así que sumarle
 * 30 días lo deja en septiembre y la corrida siguiente genera otra OT, y otra.
 * Sin esto, encender la generación automática sobre la base de hoy escribe
 * tres filas en el libro que mira la planta por un trabajo que no se va a
 * hacer tres veces.
 *
 * Se decidió a pedido el 29/10/2026: de lo perdido sale **una sola** orden —la
 * que ya generó quien llama— y la fecha se adelanta hasta la primera futura.
 *
 * `null` quiere decir «no se repite»: una fecha fija no tiene próxima, y un
 * personalizado sin intervalo no dice cada cuánto. Quien llama cierra el
 * programado en vez de dejarlo generando para siempre.
 */
export function proximaFecha(v: Vencimiento, hoy: string): string | null {
  if (!v.next_date) return null;
  if (v.schedule_type === "FECHA_FIJA") return null;

  const paso = v.schedule_type === "PERSONALIZADO"
    ? Number(v.interval_days ?? 0)
    : CADA_CUANTO[v.schedule_type];

  if (!paso || !Number.isFinite(paso) || paso <= 0) return null;

  // Al menos una vez —aunque la fecha ya fuera futura, que no pasa cuando esto
  // lo llama la generación— y después hasta pasar el día de hoy.
  let fecha = sumarDias(v.next_date, paso);
  while (fecha <= hoy) fecha = sumarDias(fecha, paso);
  return fecha;
}
