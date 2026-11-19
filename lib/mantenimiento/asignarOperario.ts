/**
 * Las reglas de poner —o sacar— un operario de una OT desde el mes.
 *
 * Funciones puras, sin base ni red. Lo que escribe es el PATCH de
 * `/api/mantenimiento/ordenes/[id]`, que ya reparte esas tres columnas a los
 * dos lados con `repartirRegistroDeOT`.
 *
 * ── UNA ORDEN CERRADA NO SE ASIGNA ─────────────────────────────────────────
 *
 * `operario_1/2/3` no son «a quién le toca»: son **quién lo hizo**, que es lo
 * que pregunta «Registrar el trabajo» al cerrar. Medido el 19/11/2026 sobre
 * las últimas 1.000 OT, **643 tienen al menos uno cargado**, y están ahí
 * porque alguien cerró la orden. Dejar asignar sobre una cerrada reescribiría
 * el registro de lo que pasó con una intención sobre lo que va a pasar, y eso
 * no se nota: la celda queda con un nombre plausible.
 *
 * Por eso el panel asigna sólo sobre lo abierto, y el mismo campo pasa a
 * significar «a quién le toca» mientras la orden sigue viva y «quién lo hizo»
 * cuando se cierra. Es el vocabulario que ya tenía la planilla; no se inventa
 * uno nuevo (ver `operarioDelCatalogo.ts`).
 *
 * ── A UNA ORDEN DE ARRASTRE SÍ SE LE ASIGNA ────────────────────────────────
 *
 * Una OT atrasada aparece en el mes el día que se la mira, no el día de su
 * `fecha_ejecucion`, y eso **no la saca de la asignación**: lo único que
 * decide si admite gente es el estado. Lo que sí cambia es contra qué se
 * calculan el turno y la falta: **contra el día que se está mirando**, nunca
 * contra el inicio de la orden. Una orden del 12 vista el 19 tiene que
 * ofrecer a quien viene el 19 y en el turno del 19 — preguntar por el 12
 * sería ofrecer a alguien que ese día ya no está de ese turno, o que está de
 * franco hoy.
 *
 * ── SACAR SÓLO PEGA SI LA PLANILLA SE DEJÓ ESCRIBIR ────────────────────────
 *
 * Poner un nombre y sacarlo son el mismo PATCH, pero **no tienen la misma
 * red**. Si la escritura en Sheets falla, la OT queda con `sheets_pendiente` y
 * la cola se rearma **desde la fila de la tabla**: para un nombre puesto eso
 * alcanza —la fila lo tiene y el drenaje lo escribe—, pero para un vaciado no,
 * porque una celda que quedó en null es indistinguible de una que nunca se
 * llenó, y lo que hay en la planilla es el nombre viejo. La próxima
 * sincronización lo trae de vuelta.
 *
 * Arreglarlo de verdad pide una columna que recuerde qué campos se vaciaron
 * —lo que ya hace `sheets_pendiente_campos` en los avisos—, o sea una
 * migración. Mientras tanto: **el fallo de la escritura se le dice a la
 * persona en el momento**, y la pantalla no finge que lo sacó.
 */

import { CERRADAS } from "./alertas";
import type { OperarioDelCatalogo } from "./operarioDelCatalogo";
import type { Turno } from "./programacion";

export interface OrdenQueSeAsigna {
  estado: string | null;
  operario_1: string | null;
  operario_2: string | null;
  operario_3: string | null;
}

/** El nombre de columna de una posición del catálogo, o null si no es 1, 2 ni 3. */
function columnaDelSlot(slot: number): keyof OrdenQueSeAsigna | null {
  if (slot === 1) return "operario_1";
  if (slot === 2) return "operario_2";
  if (slot === 3) return "operario_3";
  return null;
}

/**
 * El motivo por el que a esa orden no se le puede asignar gente, o null.
 *
 * Lo decide **el estado y nada más**. Una orden sin estado se deja asignar: no
 * consta que esté cerrada, y negarse por un dato que falta esconde la orden en
 * vez de explicarla.
 */
export function porQueNoSePuedeAsignar(o: OrdenQueSeAsigna): string | null {
  if (o.estado && CERRADAS.includes(o.estado)) {
    return "Esta orden ya está cerrada: ahí ya dice quién lo hizo.";
  }
  return null;
}

/**
 * El motivo por el que ese nombre no entra en esa orden, o null si entra.
 *
 * **No pisa nunca**: una posición ocupada se informa con el nombre que tiene,
 * para que quien asigna decida si lo saca. Y el mismo nombre no entra dos
 * veces, aunque sea en otra posición — la planilla las respeta las 1.223 de
 * 1.223, pero el catálogo tiene filas repetidas de nombre en teoría y una OT
 * con la misma persona dos veces no significa nada.
 */
export function porQueNoEntra(
  o: OrdenQueSeAsigna,
  operario: OperarioDelCatalogo,
): string | null {
  const cerrada = porQueNoSePuedeAsignar(o);
  if (cerrada) return cerrada;

  const columna = columnaDelSlot(operario.slot);
  if (!columna) {
    return `«${operario.nombre}» no tiene una columna de operario en la que entrar.`;
  }

  const yaEsta = (["operario_1", "operario_2", "operario_3"] as const).some(
    (c) => (o[c] ?? "").trim() === operario.nombre.trim(),
  );
  if (yaEsta) return `«${operario.nombre}» ya está en esta orden.`;

  const ocupada = (o[columna] ?? "").trim();
  if (ocupada) {
    return `Esa posición la tiene «${ocupada}»: hay que sacarlo antes.`;
  }

  return null;
}

/**
 * El cuerpo del PATCH que pone ese nombre, o que vacía esa posición.
 *
 * Manda **`""` y no `null`** para vaciar: lo que decide en
 * `repartirRegistroDeOT` es que la clave **venga**, y su `texto()` convierte el
 * vacío en `null` para la tabla y en celda vacía para la planilla. Omitir la
 * clave dejaría el nombre donde estaba, sin error y sin aviso.
 *
 * Y manda **sólo** esa columna: el PATCH de la OT es uno solo para el estado,
 * las horas, el contratista, los tres operarios y la falla, así que un cuerpo
 * con campos de más reescribiría encima lo que otro corrigió mientras tanto.
 */
export function elCuerpoDeLaAsignacion(
  id: string,
  slot: number,
  nombre: string | null,
): Record<string, unknown> {
  const columna = columnaDelSlot(slot);
  if (!columna) return { id };
  return { id, [columna]: nombre ?? "" };
}

/**
 * El turno real de una persona un día: la pisada si la hay, si no el ciclo.
 *
 * La franja de la semana habla del ciclo —ver `rotacionDeLaSemana.ts`— y acá
 * se mira **un día**, que es donde la pisada vale. Una pisada sobre alguien
 * que el ciclo no ubica igual lo ubica: es un turno que alguien escribió a
 * mano para ese día.
 */
export function turnoDelDia(
  delCiclo: Turno | null,
  pisada: Turno | null,
): Turno | null {
  return pisada ?? delCiclo;
}
