/**
 * Las etapas por las que pasa una oportunidad, y lo que se deduce de ellas.
 *
 * ── POR QUÉ LA PROBABILIDAD NO ESTÁ EN LA TABLA ─────────────
 *
 * Porque entonces habría dos verdades. Una oportunidad en etapa «Ganada» con
 * `probabilidad = 30` es una contradicción que la base no puede impedir y que
 * nadie va a notar hasta que el embudo diga un número raro. Acá la etapa es el
 * único dato guardado y todo lo demás —si está abierta, cuánto pondera, en qué
 * orden se muestra— sale de esta tabla.
 *
 * Es la misma decisión que el estado de una condición insegura
 * (`lib/seguridadHigiene/condicion.ts`) y que los tiempos de una orden de carga.
 *
 * ── LA PROBABILIDAD ES UNA PONDERACIÓN, NO UN PRONÓSTICO ────
 *
 * No sale de ningún histórico: **no hay histórico todavía**. Son los números
 * de manual (10/25/50/75) y están acá para que el embudo ponderado ordene las
 * oportunidades entre sí, no para decir que una cotizada se gana la mitad de
 * las veces. Cuando haya un año de oportunidades cerradas, el número real se
 * calcula de ahí y se reemplaza acá, en un solo lugar.
 *
 * Que sea un supuesto y no una medición es justamente por qué el embudo muestra
 * **también** el monto sin ponderar: el número que no depende de este archivo.
 *
 * ── ESTA LISTA ES EL ESPEJO DE UN CHECK EN LA BASE ──────────
 *
 * `ventas_oportunidades.etapa` tiene un `check` con exactamente estas seis
 * claves (migración `20261112105023_ventas_crm_schema.sql`). Agregar una etapa
 * acá sin agregarla allá hace que la ruta guarde y la base conteste 23514, que
 * es un error que no le dice nada a quien está cargando. `etapas.test.ts` fija
 * la lista para que el cambio no pase desapercibido, pero **no puede ver la
 * base**: el check hay que tocarlo a mano, con otra migración.
 */

export type ClaveDeEtapa =
  | "contacto_inicial"
  | "relevamiento"
  | "cotizada"
  | "negociacion"
  | "ganada"
  | "perdida";

export interface Etapa {
  clave: ClaveDeEtapa;
  /** Cómo se lee en pantalla. */
  nombre: string;
  /** Orden en el embudo, de la primera a la última. Las cerradas van al final. */
  orden: number;
  /** Si la oportunidad sigue en juego. Las dos cerradas son `false`. */
  abierta: boolean;
  /** 0 a 100. Ver arriba: es una ponderación, no un pronóstico. */
  probabilidad: number;
  /** Un color por etapa, para la columna del embudo y la insignia de la ficha. */
  color: string;
}

export const ETAPAS: Etapa[] = [
  {
    clave: "contacto_inicial",
    nombre: "Contacto inicial",
    orden: 1,
    abierta: true,
    probabilidad: 10,
    color: "#64748B",
  },
  {
    clave: "relevamiento",
    nombre: "Relevamiento",
    orden: 2,
    abierta: true,
    probabilidad: 25,
    color: "#0284C7",
  },
  {
    clave: "cotizada",
    nombre: "Cotizada",
    orden: 3,
    abierta: true,
    probabilidad: 50,
    color: "#7C3AED",
  },
  {
    clave: "negociacion",
    nombre: "Negociación",
    orden: 4,
    abierta: true,
    probabilidad: 75,
    color: "#B45309",
  },
  { clave: "ganada", nombre: "Ganada", orden: 5, abierta: false, probabilidad: 100, color: "#15803D" },
  { clave: "perdida", nombre: "Perdida", orden: 6, abierta: false, probabilidad: 0, color: "#B91C1C" },
];

const POR_CLAVE = new Map<string, Etapa>(ETAPAS.map((e) => [e.clave, e]));

/** Las claves válidas, para los esquemas de zod y los filtros. */
export const CLAVES_DE_ETAPA = ETAPAS.map((e) => e.clave) as [ClaveDeEtapa, ...ClaveDeEtapa[]];

/** Las cuatro etapas en las que la oportunidad sigue en juego, en orden. */
export const ETAPAS_ABIERTAS = ETAPAS.filter((e) => e.abierta);

/**
 * La etapa de una clave, o `null` si no es ninguna.
 *
 * Devuelve null en vez de lanzar porque quien la llama suele venir de una fila
 * de la base o de un query string: una etapa que no se reconoce se muestra como
 * desconocida, y eso es mejor que una pantalla en blanco.
 */
export function etapaDe(clave: string | null | undefined): Etapa | null {
  if (!clave) return null;
  return POR_CLAVE.get(clave) ?? null;
}

/** Si una oportunidad en esa etapa sigue en juego. Una clave que no existe no cuenta como abierta. */
export function estaAbierta(clave: string | null | undefined): boolean {
  return etapaDe(clave)?.abierta ?? false;
}

/**
 * Si se puede pasar de una etapa a otra.
 *
 * **Se puede ir para atrás, y es a propósito**: una cotización que vuelve a
 * relevamiento porque el cliente cambió el pedido es algo que pasa, y obligar a
 * cerrarla y abrir otra rompe el historial de esa venta.
 *
 * Lo único que no se puede es **salir de una cerrada**. No por purismo: el día
 * que se cierra queda en `cerrada_el` y alimenta el informe del mes. Reabrirla
 * dejaría una fecha de cierre sobre algo que no está cerrado, que es la clase
 * de dato que después nadie sabe interpretar. Para eso se abre una oportunidad
 * nueva, que además es lo que de verdad pasó: el cliente volvió.
 */
export function sePuedePasarDe(desde: string | null | undefined, hasta: string): boolean {
  const origen = etapaDe(desde);
  const destino = etapaDe(hasta);
  if (!destino) return false;
  // Sin etapa de origen es un alta: cualquier etapa válida sirve.
  if (!origen) return true;
  if (origen.clave === destino.clave) return true;
  return origen.abierta;
}
