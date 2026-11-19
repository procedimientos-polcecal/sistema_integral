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
 * Una posición ocupada se informa con el nombre que tiene, para que quien
 * asigna decida si lo saca. Y el mismo nombre no entra dos veces, aunque sea en
 * otra posición — la planilla las respeta las 1.223 de 1.223, pero el catálogo
 * tiene filas repetidas de nombre en teoría y una OT con la misma persona dos
 * veces no significa nada.
 *
 * **Lo que esto garantiza es que no se pisa lo que la pantalla ve, y no que no
 * se pise.** La decide sobre la foto que trajo el mes, y el PATCH de
 * `/api/mantenimiento/ordenes` **no tiene guarda** sobre estas tres columnas
 * —ni puede tenerla a secas: «Registrar el trabajo» escribe las mismas celdas
 * al cerrar y ahí pisar es lo correcto—. Así que con dos pestañas abiertas, la
 * segunda escribe sobre lo que puso la primera, sin error y sin aviso. Vale
 * saberlo y hoy no se cierra: la pantalla es de admin, la grilla se vuelve a
 * pedir en cada asignación, y el resultado se ve al recargar.
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
 * Por qué una posición no tiene a nadie para ofrecer, o null si tiene.
 *
 * Existe porque el panel se abría con tres desplegables vacíos y **ningún
 * cartel** cuando `/api/mantenimiento/taller-del-mes` fallaba o todavía no
 * había contestado: eso es indistinguible de «el catálogo de operarios está
 * vacío», y es la regla escrita del repo —un diagnóstico que no se distingue
 * de otro no es un diagnóstico—.
 *
 * **El error gana sobre «todavía está cargando»**: si los dos son ciertos, el
 * que explica algo es el error.
 */
export function porQueNoHayAQuienElegir(
  cuantos: number,
  error: string | null,
  cargando: boolean,
): string | null {
  if (cuantos > 0) return null;
  if (error) return `No se pudo traer el taller: ${error}`;
  if (cargando) return "Buscando a la gente del taller…";
  return "El catálogo de operarios está vacío. Se carga en Mantenimiento → Configuración.";
}

/**
 * Qué se le dice a la persona cuando la planilla no se dejó escribir.
 *
 * `null` quiere decir que no hubo fallo. Lo que dijo Google va **sin traducir**,
 * que es la regla de la casa: un fallo de escritura que no se distingue de otro
 * costó una tarde entera.
 *
 * **Sacar lleva una advertencia de más**, y es la única defensa que el diseño
 * aceptó para el vaciado: ver el tercer bloque del encabezado.
 */
export function elAvisoDeLaPlanilla(
  nombre: string | null,
  error: string | null,
  queSacaba?: string | null,
): string | null {
  if (!error) return null;
  if (nombre !== null) return `No se pudo escribir la planilla: ${error}`;
  const quien = queSacaba?.trim() ? `a «${queSacaba.trim()}»` : "el nombre";
  return (
    `No se pudo escribir la planilla: ${error} — hay que sacar ${quien} también a mano allá, ` +
    `porque la sincronización lo va a devolver.`
  );
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
