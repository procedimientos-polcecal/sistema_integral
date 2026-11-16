import { labelTipoAusencia } from "./tiposAusencia";

/**
 * El resumen de novedades que RR.HH. manda al cierre del día.
 *
 * ## Qué es una «novedad»
 *
 * En este sistema la palabra ya tenía dueño: `NOVEDADES` era la pestaña de
 * Google donde RR.HH. llevaba a mano las ausencias, y el spec del 29/10/2026 la
 * dio vuelta para que el SdG sea el único lugar donde se cargan. O sea que la
 * novedad de siempre es **la ausencia**. A pedido del 16/11/2026 se suman los
 * francos y las vacaciones.
 *
 * ## Las tres decisiones que no se deducen del código, todas medidas
 *
 * 1. **Una vacación que nació de una ausencia no se lista aparte.** Cargar una
 *    ausencia de tipo `VACACIONES` crea además la fila en `vacaciones`, con su
 *    `ausencia_id` apuntando a la primera. Medido el 16/11/2026: de 41
 *    vacaciones, **21 tienen `ausencia_id`**. Listar las dos cosas haría que la
 *    misma licencia apareciera dos veces en el mismo correo, con fechas
 *    distintas —el período y los días hábiles no coinciden—, que es la forma
 *    más rápida de que alguien deje de creerle al resumen. Entran sólo las que
 *    se cargaron solas, en la pestaña de vacaciones.
 *
 * 2. **Los francos generados y los tomados van en secciones separadas, y la
 *    diferencia está escrita en el correo.** No son lo mismo aunque sean la
 *    misma tabla: el franco lo **genera el recálculo** cuando alguien trabajó
 *    un domingo, y lo **toma una persona** apretando un botón. Medido sobre los
 *    140 francos creados desde el 01/10/2026: llegan en montones de 13 a 18 y
 *    casi siempre un lunes —17 el lunes 16/11, 14 el lunes 09/11, 18 el lunes
 *    02/11—, y de esos 140 **sólo 5 llegaron a marcarse tomados**, en 3 días.
 *    Un correo que diga «17 novedades» un lunes, cuando ninguna la cargó nadie,
 *    enseña a no abrirlo. Van, porque se pidieron, pero dicen lo que son.
 *
 * 3. **El día es el día de Argentina y se calcula sobre `created_at`**, que es
 *    cuándo se cargó, no sobre `fecha_desde`, que es cuándo falta la persona.
 *    Son cosas distintas y la que importa acá es la primera: el correo cuenta
 *    lo que se cargó hoy, y lo normal es cargar una ausencia de la semana
 *    pasada o de la que viene.
 *
 * ## Lo que esto cuesta, dicho
 *
 * Medido sobre los 46 días desde el 01/10/2026: con las tres cosas, **23 de 46
 * días** habrían mandado correo; sólo con ausencias, 10. O sea que sumar los
 * francos duplica los días con correo, y la mitad de esos días el contenido es
 * el montón automático del lunes. Si alguna vez molesta, lo que hay que sacar
 * son los francos generados —una línea en la ruta del cron—, y no el correo.
 *
 * Todo lo de acá es puro: no toca la base ni manda nada.
 */

/** Una persona, como la nombra el correo. */
export interface PersonaDeLaNovedad {
  apellido?: string | null;
  nombre?: string | null;
  legajo?: string | null;
}

export interface AusenciaNueva {
  empleado: PersonaDeLaNovedad | null;
  fecha_desde: string;
  fecha_hasta: string;
  tipo: string;
  justificada: boolean | null;
  observaciones?: string | null;
  cargadaPor?: string | null;
}

export interface VacacionNueva {
  empleado: PersonaDeLaNovedad | null;
  fecha_desde: string;
  fecha_hasta: string;
  dias_tomados: number | string | null;
  anio_correspondiente: number | string | null;
  /** Cuando viene de una ausencia, no se lista: ya está en la otra sección. */
  ausencia_id: string | null;
}

export interface FrancoNuevo {
  empleado: PersonaDeLaNovedad | null;
  fecha_generado: string;
  horas: number | string | null;
}

export interface FrancoTomado {
  empleado: PersonaDeLaNovedad | null;
  fecha_generado: string;
  fecha_tomado: string;
  horas: number | string | null;
}

export interface NovedadesDelDia {
  ausencias: AusenciaNueva[];
  vacaciones: VacacionNueva[];
  francosTomados: FrancoTomado[];
  francosGenerados: FrancoNuevo[];
}

/** "2026-11-16" → "16/11/2026". Acepta un timestamp completo. */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

const NOMBRE_DEL_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * "2026-11-16" → "lunes 16/11/2026".
 *
 * El nombre del día va escrito y no sale de `toLocaleDateString`: esto corre en
 * el servidor de Vercel, cuyo ICU no tiene por qué traer `es-AR`, y ahí el
 * asunto del correo saldría en inglés.
 */
export function diaLargo(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return `${NOMBRE_DEL_DIA[d] ?? ""} ${fechaCorta(iso)}`.trim();
}

/** "CEJAS, MARIO AGUSTIN (PC_118)", o un aviso si el empleado no se pudo leer. */
export function comoSeLlama(p: PersonaDeLaNovedad | null): string {
  if (!p) return "(empleado no encontrado)";
  const nombre = [p.apellido, p.nombre].filter(Boolean).join(", ");
  if (!nombre) return "(empleado sin nombre)";
  return p.legajo ? `${nombre} (${p.legajo})` : nombre;
}

/** "del 16/11/2026 al 18/11/2026", o "el 16/11/2026" cuando es un día solo. */
export function rangoDeFechas(desde: string, hasta: string): string {
  const d = fechaCorta(desde);
  const h = fechaCorta(hasta);
  return d === h ? `el ${d}` : `del ${d} al ${h}`;
}

/**
 * Las vacaciones que entran al correo: las que **no** nacieron de una ausencia.
 *
 * Ver la decisión 1 del encabezado. Separada en su propia función para poder
 * fijarla con un test: es la que evita que la misma licencia salga dos veces.
 */
export function vacacionesQueNoSonUnaAusencia<T extends { ausencia_id: string | null }>(vacaciones: T[]): T[] {
  return vacaciones.filter((v) => !v.ausencia_id);
}

/** Cuántas novedades hay en total, contando las cuatro secciones. */
export function cuantasSon(n: NovedadesDelDia): number {
  return (
    n.ausencias.length + n.vacaciones.length + n.francosTomados.length + n.francosGenerados.length
  );
}

/**
 * Si hay algo que mandar.
 *
 * **Sin novedades no se manda nada**, que es lo primero que pidió el usuario y
 * también la regla que ya sigue el resumen diario por push: un correo que
 * algunos días dice «no pasó nada» es el que enseña a archivarlos sin leer.
 * Medido: de 46 días, 23 no habrían tenido nada.
 */
export function hayAlgoQueMandar(n: NovedadesDelDia): boolean {
  return cuantasSon(n) > 0;
}

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * El asunto.
 *
 * Lleva la cuenta de cada cosa, y no sólo el total, porque el asunto es lo
 * único que muchos van a leer: «3 ausencias» y «17 francos generados» piden
 * cosas distintas de quien lo recibe. Las secciones vacías no se nombran.
 */
export function asuntoDelCorreo(n: NovedadesDelDia, dia: string): string {
  const partes: string[] = [];
  if (n.ausencias.length) partes.push(plural(n.ausencias.length, "ausencia", "ausencias"));
  if (n.vacaciones.length) partes.push(plural(n.vacaciones.length, "vacación", "vacaciones"));
  if (n.francosTomados.length) partes.push(plural(n.francosTomados.length, "franco tomado", "francos tomados"));
  if (n.francosGenerados.length) partes.push(plural(n.francosGenerados.length, "franco generado", "francos generados"));
  return `RR.HH. — novedades del ${fechaCorta(dia)}: ${partes.join(", ")}`;
}

function seccion(titulo: string, aclaracion: string | null, renglones: string[]): string[] {
  if (!renglones.length) return [];
  const bloque = [`${titulo.toUpperCase()} (${renglones.length})`];
  if (aclaracion) bloque.push(aclaracion);
  bloque.push(...renglones);
  bloque.push("");
  return bloque;
}

function horasDe(h: number | string | null): string {
  const n = Number(h ?? 0);
  return isFinite(n) ? `${Math.round(n * 100) / 100} h` : "? h";
}

/**
 * Un texto de varios renglones metido adentro de un renglón sangrado.
 *
 * Una observación puede venir con Enter adentro —y vienen: «Envía certificado
 * por WhatsApp⏎Laringitis»— y sin esto el segundo renglón sale pegado al
 * margen, donde se lee como una novedad nueva y no como la continuación de la
 * anterior. Se vio en el correo del 13/11/2026 armado con los datos reales.
 */
function sangrado(texto: string, espacios: string): string {
  return texto.replace(/\r?\n/g, `\n${espacios}`);
}

/**
 * El cuerpo del correo, en texto plano.
 *
 * Texto plano y no HTML porque el Apps Script manda con
 * `MailApp.sendEmail(para, asunto, cuerpo)`, que toma el tercer argumento como
 * texto. Mandar HTML ahí lo muestra con las etiquetas a la vista.
 *
 * El encabezado y el cierre los escribe quien quiera desde RR.HH. →
 * Configuración; si están vacíos no se inventa nada y el correo arranca
 * directamente por las novedades. El medio —las cuatro secciones— no es
 * configurable a propósito: es el dato, y dejarlo editable permitiría un
 * resumen que no dice lo que pasó.
 */
export function cuerpoDelCorreo(
  n: NovedadesDelDia,
  dia: string,
  texto: { encabezado?: string | null; cierre?: string | null } = {}
): string {
  const lineas: string[] = [];

  const encabezado = (texto.encabezado ?? "").trim();
  if (encabezado) lineas.push(encabezado, "");

  lineas.push(`Novedades cargadas el ${diaLargo(dia)}.`, "");

  lineas.push(
    ...seccion(
      "Ausencias",
      null,
      n.ausencias.map((a) => {
        const cabeza = `- ${comoSeLlama(a.empleado)} — ${rangoDeFechas(a.fecha_desde, a.fecha_hasta)} · ${labelTipoAusencia(a.tipo)} · ${a.justificada ? "justificada" : "injustificada"}`;
        const detalle: string[] = [];
        if (a.observaciones?.trim()) detalle.push(`    Observaciones: ${sangrado(a.observaciones.trim(), "    ")}`);
        if (a.cargadaPor) detalle.push(`    La cargó: ${a.cargadaPor}`);
        return [cabeza, ...detalle].join("\n");
      })
    )
  );

  lineas.push(
    ...seccion(
      "Vacaciones",
      null,
      n.vacaciones.map(
        (v) =>
          `- ${comoSeLlama(v.empleado)} — ${rangoDeFechas(v.fecha_desde, v.fecha_hasta)} · ${v.dias_tomados ?? "?"} días · año ${v.anio_correspondiente ?? "?"}`
      )
    )
  );

  lineas.push(
    ...seccion(
      "Francos marcados como tomados",
      null,
      n.francosTomados.map(
        (f) => `- ${comoSeLlama(f.empleado)} — ${horasDe(f.horas)}, generado el ${fechaCorta(f.fecha_generado)}`
      )
    )
  );

  lineas.push(
    ...seccion(
      "Francos generados por el sistema",
      "  (los genera el recálculo cuando alguien trabajó un domingo; no los carga una persona)",
      n.francosGenerados.map(
        (f) => `- ${comoSeLlama(f.empleado)} — ${horasDe(f.horas)} por el domingo ${fechaCorta(f.fecha_generado)}`
      )
    )
  );

  const cierre = (texto.cierre ?? "").trim();
  if (cierre) lineas.push(cierre);

  // Un renglón vacío de más al final del último bloque no aporta nada.
  while (lineas.length && lineas[lineas.length - 1] === "") lineas.pop();

  return lineas.join("\n");
}

/** El texto que trae la configuración recién creada, antes de que nadie la toque. */
export const ENCABEZADO_POR_DEFECTO =
  "Buenas tardes:\n\nVan las novedades de personal cargadas hoy en el sistema.";

export const CIERRE_POR_DEFECTO =
  "Cualquier corrección, respondé este correo.\n\n-- \nGestión de Personas\nEste correo lo manda el Sistema de Gestión automáticamente al cierre del día. Si no hubo novedades, no se envía.";

/**
 * A quién le llega.
 *
 * **Sin nadie elegido va a todos los encargados**, que es lo que pidió el
 * usuario, y la lista se arma en el momento del envío: así, un encargado nuevo
 * empieza a recibirlo sin que nadie se acuerde de agregarlo.
 *
 * LA CONSECUENCIA QUE NO SE DEDUCE SOLA, y que la pantalla también dice: **en
 * cuanto alguien tilda a una persona, la regla deja de correr.** A partir de
 * ahí la lista es exactamente la que quedó tildada, y un encargado que entre
 * después no va a recibir nada hasta que alguien lo agregue a mano. Es el
 * precio de poder elegir, y es preferible a mezclar las dos cosas: una lista
 * que además manda a gente que no figura en ella es imposible de auditar
 * mirando la pantalla.
 *
 * Una dirección vacía o repetida se descarta: la lista guarda ids de usuario y
 * nada impide que uno quede sin correo o que la misma persona entre dos veces.
 */
export interface CandidatoACorreo {
  id: string;
  email?: string | null;
  rol?: string | null;
  activo?: boolean | null;
}

export function destinatariosDelCorreo(
  usuarios: CandidatoACorreo[],
  elegidos: string[] | null | undefined
): string[] {
  const vivos = usuarios.filter((u) => u.activo !== false && (u.email ?? "").trim());
  const seleccion = (elegidos ?? []).length
    ? vivos.filter((u) => elegidos!.includes(u.id))
    : vivos.filter((u) => u.rol === "encargado");
  return [...new Set(seleccion.map((u) => u.email!.trim().toLowerCase()))];
}
