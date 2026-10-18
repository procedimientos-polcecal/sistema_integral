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
