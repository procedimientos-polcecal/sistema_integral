/**
 * Una OT que nace cerrada.
 *
 * El caso no es raro: es **el más común de los que se cargan desde la app**.
 * De las seis órdenes creadas en el sistema hasta el 18/10/2026, cinco nacieron
 * con fecha de cierre, horas y operarios — no se estaba pidiendo trabajo, se
 * estaba cargando trabajo ya hecho.
 *
 * Dos reglas, y la segunda sale de la primera: si la fecha de cierre dice que
 * ya se hizo, entonces tiene que decir también cuánto llevó y quién la hizo.
 */

/** Los estados en que puede nacer una orden, como los guarda el sistema. */
type Estado = string;

/**
 * El estado que le corresponde a una orden según su fecha de cierre.
 *
 * **La fecha manda sobre lo que se haya elegido.** Tener cierre y decir "en
 * proceso" es contradecirse, y elegir el estado a mano teniendo la fecha es
 * contestar dos veces la misma pregunta — que es donde quedan las OT cerradas
 * figurando "por hacer".
 *
 * Sin fecha vale lo elegido, y sin nada se parte de "por hacer", que es de
 * donde se parte.
 */
export function estadoSegunElCierre(
  fechaCierre: string | null | undefined,
  estadoElegido: Estado | null | undefined
): Estado {
  if (String(fechaCierre ?? "").trim()) return "REALIZADO";
  return String(estadoElegido ?? "").trim() || "POR_HACER";
}

/** Lo que el formulario sabe de quién hizo el trabajo. */
export interface DatosDelCierre {
  fecha_cierre: string | null | undefined;
  horas: string | null | undefined;
  /** INTERNO, CONTRATADO o MIXTO. Decide a quién hay que nombrar. */
  quien: string | null | undefined;
  contratista: string | null | undefined;
  operario_1: string | null | undefined;
  operario_2: string | null | undefined;
  operario_3: string | null | undefined;
}

const cargado = (v: string | null | undefined): boolean => String(v ?? "").trim() !== "";

/**
 * Qué le falta a una orden para poder darse por cerrada.
 *
 * Se exige **sólo cuando hay fecha de cierre**: sin ella se está pidiendo
 * trabajo, no cargándolo, y ahí no hay horas ni operarios que poner.
 *
 * Quién la hizo depende de quién la hace: un trabajo interno necesita al menos
 * un operario, uno contratado necesita el contratista, y uno mixto los dos.
 * Pedirle operarios a un trabajo contratado sería trabar el formulario por un
 * dato que no existe.
 *
 * Devuelve **todo junto y no de a uno**, que es la vara de `validar()` del
 * núcleo: contestar un formulario tres veces para que te digan tres cosas es lo
 * que hace que la gente lo complete de cualquier manera.
 *
 * Por qué se exige, que es lo que no se ve al escribirlo: una OT cerrada sin
 * horas ni operarios no sirve para nada de lo que vino después —el MTBF, las
 * horas por sector, el costo— y nadie se entera hasta que el informe sale con
 * la mitad de las filas vacías.
 */
export function loQueFaltaParaCerrar(datos: DatosDelCierre): string[] {
  if (!cargado(datos.fecha_cierre)) return [];

  const falta: string[] = [];

  // Cero es un dato —hay trabajos de minutos— y vacío es que no lo cargaron.
  if (!cargado(datos.horas)) falta.push("las horas que llevó");

  const quien = String(datos.quien ?? "").trim().toUpperCase();
  const hayOperario =
    cargado(datos.operario_1) || cargado(datos.operario_2) || cargado(datos.operario_3);

  if (quien !== "CONTRATADO" && !hayOperario) falta.push("al menos un operario");
  if ((quien === "CONTRATADO" || quien === "MIXTO") && !cargado(datos.contratista)) {
    falta.push("el contratista");
  }

  return falta;
}

/** Lo que una orden recién creada puede tener para la planilla. */
export interface LoQueLaPlanillaNoSabe {
  estado: string | null | undefined;
  fecha_cierre: string | null | undefined;
  horas: number | null | undefined;
  contratista: string | null | undefined;
  operario_1: string | null | undefined;
  operario_2: string | null | undefined;
  operario_3: string | null | undefined;
}

/**
 * Qué hay que escribirle al master de una orden recién creada, o `null` si no
 * hay nada.
 *
 * Esas columnas —`K` cierre, `M` estado, `N` contratista, `O` horas, `P`/`Q`/`R`
 * operarios— son literales del master, y **el alta no las puede escribir en el
 * momento**: la fila todavía no existe, porque llega por `IMPORTRANGE` desde la
 * hoja de respuestas y eso tarda. Queda anotado en `sheets_pendiente` y lo
 * termina la sincronización.
 *
 * Qué pasa si no se hace, medido el 18/10/2026: el cron de las 06:00 lee la
 * `M`, la encuentra vacía y pisa el estado del sistema; con las horas es peor,
 * porque las lee de la `O` y las pisa con `null`. Las cinco OT que hoy siguen
 * en REALIZADO lo están porque alguien les escribió "Realizado" a mano.
 *
 * **Lo que está vacío no viaja.** `celdasParaRegistrar` vacía la celda cuando
 * se le pasa `null`, y vaciar una celda que nadie llenó es escribir de más en
 * una planilla que mira gente. Por eso se arma con las claves presentes y no
 * con todas en `null`.
 *
 * Y si no hay nada, `null` en vez de un registro vacío: una cola con filas que
 * no tienen nada que hacer deja de decir si algo está trabado.
 */
export function loQueHayQueExportar(orden: LoQueLaPlanillaNoSabe): Record<string, unknown> | null {
  const registro: Record<string, unknown> = {};

  const estado = String(orden.estado ?? "").trim();
  // "Por hacer" es el único estado que NO se exporta, y no por ahorrar una
  // escritura: la `M` trae `=IF(J="","",L)`, la fórmula con la que la planilla
  // marca sola lo atrasado. Escribirle "Por hacer" la reemplaza por un literal
  // y la orden queda fija en "por hacer" el día que se pase de fecha.
  if (estado && estado !== "POR_HACER") registro.estado = estado;

  if (cargado(orden.fecha_cierre)) registro.fecha_cierre = orden.fecha_cierre;
  // Cero horas es un dato —hay trabajos de minutos— y tiene que llegar.
  if (orden.horas !== null && orden.horas !== undefined) registro.horas = orden.horas;
  if (cargado(orden.contratista)) registro.contratista = orden.contratista;
  if (cargado(orden.operario_1)) registro.operario_1 = orden.operario_1;
  if (cargado(orden.operario_2)) registro.operario_2 = orden.operario_2;
  if (cargado(orden.operario_3)) registro.operario_3 = orden.operario_3;

  // Si lo único que hay es el estado por hacer, no hay nada que exportar: las
  // horas y los operarios tienen que poder viajar solos, sin el estado.
  return Object.keys(registro).length > 0 ? registro : null;
}
