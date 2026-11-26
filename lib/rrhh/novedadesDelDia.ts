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
 * 1. **Una vacación y su ausencia son la misma novedad, y se escriben una sola
 *    vez: en la sección de vacaciones.** Cargar vacaciones crea dos filas —la
 *    ausencia de tipo `VACACIONES` y el período en `vacaciones`, con su
 *    `ausencia_id`— y listar las dos pone la misma licencia dos veces en el
 *    mismo correo, que es la forma más rápida de que alguien deje de creerle.
 *
 *    **Gana la de `vacaciones` porque dice más.** Las fechas son idénticas
 *    —`sincronizarPeriodoVacaciones` las copia de la ausencia— pero el período
 *    agrega `dias_tomados` y, sobre todo, `anio_correspondiente`, que es de qué
 *    año se descuentan los días. Ese dato no se deduce de las fechas y es el
 *    motivo por el que corregir un período se audita. Lo que la ausencia tiene
 *    de más —las observaciones y quién la cargó— se le pega al renglón, así
 *    que no se pierde nada.
 *
 *    **Esto estaba al revés hasta el 17/11/2026 y conviene saber por qué**, que
 *    es la parte que no se deduce del código. Cuando esto se escribió, sólo 21
 *    de 41 períodos tenían `ausencia_id`: RRHH tenía dos puertas para cargar
 *    vacaciones y una no creaba la ausencia. Con eso, descartar las atadas y
 *    listar las sueltas daba bien. El mismo día se arregló aquella puerta
 *    (`app/api/rrhh/vacaciones/route.ts`), así que **de ahora en más todas
 *    nacen atadas**: la regla vieja habría dejado la sección de vacaciones
 *    permanentemente vacía y cada licencia habría salido como un renglón de
 *    ausencia sin días ni año. Nadie lo habría notado —el correo seguía
 *    saliendo, con la vacación adentro, sólo que más pobre—, y por eso queda
 *    escrito: **la regla depende de un invariante de otro archivo**, no de algo
 *    que este módulo controle.
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
 *    Son cosas distintas y las dos se usan, cada una para lo suyo: `created_at`
 *    dice qué se movió hoy, y las fechas de la licencia dicen a qué día
 *    corresponde.
 *
 * 4. **Lo que se cargó hoy pero ya terminó no se informa** (17/11/2026, a
 *    pedido). Una ausencia del 02/11 cargada el 16/11 no es noticia para quien
 *    organiza el turno de mañana: es trabajo administrativo poniéndose al día.
 *    El corte es `fecha_hasta >= el día`, o sea que una licencia que empezó
 *    hace una semana y sigue **sí** entra. Lo que esto cuesta, medido sobre los
 *    46 días desde el 01/10/2026: de 38 ausencias cargadas, **23 eran
 *    enteramente pasadas** —10 enfermedades, 7 permisos, 5 injustificadas— y
 *    dejan de salir. Y se lleva casi todos los francos generados: **130 de
 *    143** llevan un `fecha_generado` anterior al día en que el recálculo los
 *    creó, porque los genera el lunes por el domingo. Eso fue a propósito y no
 *    de arrastre: el montón de 17 renglones automáticos de los lunes era lo que
 *    más empujaba a no abrir el correo.
 *
 * 5. **Las dos secciones de «a qué día corresponde» NO disparan el correo.**
 *    Están para que, cuando el correo salga, se lea sin cruzar nada; pero si en
 *    el día no se movió nada, no se manda igual. Es la primera regla que pidió
 *    el usuario y sigue en pie. **Sin esto el correo saldría todos los días**:
 *    medido, hubo al menos una persona ausente los **46 días de 46**, entre 2 y
 *    4 por día. Un correo diario que casi siempre dice lo mismo es el que
 *    enseña a archivarlo sin leer, que es lo que todo este archivo viene
 *    evitando.
 *
 * 6. **Las dos secciones no se pisan.** «Empiezan o terminan hoy» y «Siguen
 *    ausentes» parten en dos la misma lista —los que cubren el día— por el
 *    criterio de si ese día es el primero o el último. Listar «los que
 *    cambian» y después «todos» pondría a la misma persona dos veces en el
 *    mismo correo, que es exactamente lo que la decisión 1 evita del otro lado.
 *
 * 7. **Quién no viene se le pregunta a DOS tablas, y la segunda es
 *    `vacaciones`** (26/11/2026, a pedido). Preguntarle sólo a `ausencias`
 *    deja afuera justo las licencias más largas: de los 41 períodos de
 *    vacaciones, **20 no tienen `ausencia_id`** —son los de antes del
 *    16/11/2026, cuando una de las dos puertas de carga no creaba la
 *    ausencia— y ésos no están en `ausencias` de ninguna forma. Medido sobre
 *    los 46 días hasta el 26/11/2026: **37 tenían al menos una vacación en
 *    curso que el correo no nombraba**, y en **6 de esos días el único que
 *    faltaba estaba de vacaciones**, así que la sección salía vacía con gente
 *    de licencia. El 26/11, sin ir más lejos: 0 ausencias y 3 personas de
 *    vacaciones.
 *
 *    Esto **no** se arregla solo con el tiempo. Las que nazcan de ahora en más
 *    van a estar atadas, pero un período viejo que sigue abierto se sigue
 *    perdiendo, y los tres del 26/11 son de ésos.
 *
 *    **Juntar dos tablas es juntar dos formas de decir lo mismo**, así que una
 *    vacación se descarta por dos caminos: si su `ausencia_id` está entre las
 *    ausencias del día, y si hay una ausencia de tipo `VACACIONES` del mismo
 *    legajo con las mismas fechas. El primero es el caso normal —20 de las 21
 *    atadas tienen las fechas idénticas a su ausencia— y el segundo cubre que
 *    alguien haya cargado las dos cosas por separado, que hoy no pasa en
 *    ninguna de las 41. Es la decisión 6 otra vez: nadie dos veces en el mismo
 *    correo.
 *
 *    Y una `TARDANZA` no entra acá aunque cubra el día, porque la persona
 *    viene. Hoy no cambia nada —hay 0 cargadas— y es la misma regla que
 *    Disponibilidad, donde está escrito el porqué.
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
  /** Hace falta para saber si una vacación del día es ésta misma. */
  id?: string | null;
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
  /** La ausencia que la generó, cuando la hay: sirve para no listarla dos veces. */
  ausencia_id: string | null;
  /** Se le pegan de su ausencia, para no perderlas al no listarla. */
  observaciones?: string | null;
  cargadaPor?: string | null;
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

/** Una persona que no viene ese día, venga de donde venga su ausencia. */
export interface AusentePorHoy {
  empleado: PersonaDeLaNovedad | null;
  fecha_desde: string;
  fecha_hasta: string;
  tipo: string;
}

/**
 * Una ausencia que cubre el día, tal como la trae su tabla.
 *
 * Lleva el `id` porque es lo único que permite reconocer que una vacación del
 * día es esta misma licencia escrita del otro lado (decisión 7).
 */
export interface AusenciaEnCurso extends AusentePorHoy {
  id?: string | null;
}

/** Un período de vacaciones que cubre el día. La segunda puerta de la decisión 7. */
export interface VacacionEnCurso {
  empleado: PersonaDeLaNovedad | null;
  fecha_desde: string;
  fecha_hasta: string;
  /** La ausencia que lo generó, cuando la hay. Null en los 20 períodos viejos. */
  ausencia_id: string | null;
}

export interface NovedadesDelDia {
  // ── Los movimientos: lo que se cargó ese día. Son los que disparan el correo.
  ausencias: AusenciaNueva[];
  vacaciones: VacacionNueva[];
  francosTomados: FrancoTomado[];
  francosGenerados: FrancoNuevo[];
  // ── A qué día corresponde: no disparan nada (decisión 5 del encabezado).
  empiezanOTerminan: AusentePorHoy[];
  siguenAusentes: AusentePorHoy[];
}

/** Un `NovedadesDelDia` vacío, para construir sobre él sin olvidarse una lista. */
export const SIN_NOVEDADES: NovedadesDelDia = {
  ausencias: [],
  vacaciones: [],
  francosTomados: [],
  francosGenerados: [],
  empiezanOTerminan: [],
  siguenAusentes: [],
};

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
 * Reparte las dos listas para que una licencia salga **una sola vez**, en la
 * sección de vacaciones, y con todo lo que se sabe de ella.
 *
 * Ver la decisión 1 del encabezado. Separada en su propia función para poder
 * fijarla con un test, porque es la que sostiene esa decisión.
 *
 * Tres casos, y los tres pasan:
 *
 * - **Vacación con su ausencia, las dos del día.** Sale una vez, como
 *   vacación, con las observaciones y el autor de la ausencia pegados. La
 *   ausencia no se lista.
 * - **Vacación suelta**, sin `ausencia_id` — las 20 viejas, o una que se
 *   cargue por un camino que no cree la ausencia. Sale como vacación, sin
 *   observaciones. No se inventa nada.
 * - **Ausencia de tipo VACACIONES sin período del día**, porque el período se
 *   creó otro día o porque no se creó. Se queda en la sección de ausencias,
 *   que es la verdad de lo que hay: decir menos es mejor que no decirlo.
 */
export function repartirVacacionesYAusencias(
  ausencias: AusenciaNueva[],
  vacaciones: VacacionNueva[]
): { ausencias: AusenciaNueva[]; vacaciones: VacacionNueva[] } {
  const porId = new Map<string, AusenciaNueva>();
  for (const a of ausencias) if (a.id) porId.set(a.id, a);

  const absorbidas = new Set<string>();
  const conDetalle = vacaciones.map((v) => {
    const suAusencia = v.ausencia_id ? porId.get(v.ausencia_id) : undefined;
    if (!suAusencia) return v;
    absorbidas.add(v.ausencia_id!);
    return { ...v, observaciones: suAusencia.observaciones, cargadaPor: suAusencia.cargadaPor };
  });

  return {
    ausencias: ausencias.filter((a) => !(a.id && absorbidas.has(a.id))),
    vacaciones: conDetalle,
  };
}

/**
 * Cuántos movimientos hay: lo que se cargó ese día.
 *
 * **No cuenta las dos secciones de presencia**, y eso es lo que las hace
 * inofensivas: ver la decisión 5 del encabezado.
 */
export function cuantasSon(n: NovedadesDelDia): number {
  return (
    n.ausencias.length + n.vacaciones.length + n.francosTomados.length + n.francosGenerados.length
  );
}

/**
 * Cuántos renglones tiene el correo entero, presencia incluida.
 *
 * **Son dos cuentas distintas a propósito y conviene no unificarlas.**
 * `cuantasSon` cuenta movimientos y es la que decide si el correo sale
 * (decisión 5): si contara la presencia, saldría todos los días. Ésta cuenta
 * renglones y sirve para una sola cosa, que es saber cuántos quedaron sin
 * listar cuando una sección pasa el tope. Usar la primera para recortar deja
 * las dos secciones de presencia cortándose en silencio.
 */
export function cuantosRenglones(n: NovedadesDelDia): number {
  return cuantasSon(n) + n.empiezanOTerminan.length + n.siguenAusentes.length;
}

/**
 * Si hay algo que mandar.
 *
 * **Sin movimientos no se manda nada**, que es lo primero que pidió el usuario
 * y también la regla que ya sigue el resumen diario por push: un correo que
 * algunos días dice «no pasó nada» es el que enseña a archivarlos sin leer.
 * Medido: de 46 días, 23 no habrían tenido ningún movimiento.
 *
 * Que alguien esté ausente **no alcanza**: lo estuvo alguien los 46 días de 46.
 */
export function hayAlgoQueMandar(n: NovedadesDelDia): boolean {
  return cuantasSon(n) > 0;
}

/**
 * Si una novedad cargada hoy habla del día o de más adelante.
 *
 * Decisión 4 del encabezado. El corte va sobre la fecha en que la novedad
 * **termina**, no sobre la que empieza: una licencia que arrancó la semana
 * pasada y sigue abierta es lo que más corresponde informar, y mirar
 * `fecha_desde` la dejaría afuera.
 */
export function tocaElDiaOElFuturo(fechaFinal: string, dia: string): boolean {
  return fechaFinal.slice(0, 10) >= dia;
}

/**
 * Saca de los movimientos lo que ya terminó antes del día.
 *
 * Las dos secciones de presencia no se tocan: no son movimientos y su criterio
 * es justamente cubrir el día.
 */
export function soloLoQueCorrespondeAlDia(n: NovedadesDelDia, dia: string): NovedadesDelDia {
  return {
    ...n,
    ausencias: n.ausencias.filter((a) => tocaElDiaOElFuturo(a.fecha_hasta, dia)),
    vacaciones: n.vacaciones.filter((v) => tocaElDiaOElFuturo(v.fecha_hasta, dia)),
    // Un franco tomado se ubica el día en que alguien lo marcó, y uno generado
    // el día que lo generó: son las dos únicas fechas que esas filas tienen.
    francosTomados: n.francosTomados.filter((f) => tocaElDiaOElFuturo(f.fecha_tomado, dia)),
    francosGenerados: n.francosGenerados.filter((f) => tocaElDiaOElFuturo(f.fecha_generado, dia)),
  };
}

/**
 * Los tipos de ausencia que cubren un día sin que la persona falte.
 *
 * Una tardanza llega tarde y trabaja: ponerla entre los que no vienen es
 * decirle al que arma el turno que le falta alguien que está. Es la misma
 * regla que Disponibilidad, donde además está medido que el mismo dato cuenta
 * distinto según quién pregunta.
 */
const NO_FALTA_ESE_DIA = new Set(["TARDANZA"]);

/** Legajo + fechas: dos filas con esta misma clave son la misma licencia. */
function clavePeriodo(a: {
  empleado: PersonaDeLaNovedad | null;
  fecha_desde: string;
  fecha_hasta: string;
}): string {
  const quien = a.empleado?.legajo ?? comoSeLlama(a.empleado);
  return [quien, a.fecha_desde.slice(0, 10), a.fecha_hasta.slice(0, 10)].join("|");
}

/**
 * Junta en una sola lista a todos los que no vienen ese día, vengan de
 * `ausencias` o de `vacaciones`.
 *
 * Es la decisión 7 del encabezado, y está separada en su propia función por lo
 * mismo que `repartirVacacionesYAusencias`: es la que sostiene la decisión y
 * tiene que poder fijarse con un test.
 *
 * **El orden es por fecha de inicio** y no el de llegada. Las dos listas vienen
 * de dos consultas distintas, así que pegarlas una atrás de la otra dejaría
 * todas las vacaciones juntas al final: quien lee el correo vería dos listas
 * ordenadas y no una.
 */
export function juntarAusentesDelDia(
  ausencias: AusenciaEnCurso[],
  vacaciones: VacacionEnCurso[]
): AusentePorHoy[] {
  const faltan = ausencias.filter((a) => !NO_FALTA_ESE_DIA.has(a.tipo));

  // Los dos caminos por los que una vacación ya está contada: atada por id, o
  // escrita aparte como una ausencia de tipo VACACIONES con las mismas fechas.
  const atadas = new Set(faltan.map((a) => a.id).filter((id): id is string => !!id));
  const yaEscritas = new Set(faltan.filter((a) => a.tipo === "VACACIONES").map(clavePeriodo));

  const deVacaciones: AusentePorHoy[] = vacaciones
    .filter((v) => !(v.ausencia_id && atadas.has(v.ausencia_id)))
    .map((v) => ({
      empleado: v.empleado,
      fecha_desde: v.fecha_desde,
      fecha_hasta: v.fecha_hasta,
      tipo: "VACACIONES",
    }))
    .filter((v) => !yaEscritas.has(clavePeriodo(v)));

  return [...faltan, ...deVacaciones].sort(
    (a, b) =>
      a.fecha_desde.slice(0, 10).localeCompare(b.fecha_desde.slice(0, 10)) ||
      comoSeLlama(a.empleado).localeCompare(comoSeLlama(b.empleado))
  );
}

/**
 * Parte en dos a los que no vienen ese día: los que cambian de estado y el
 * resto.
 *
 * Son las dos secciones de la decisión 6, y salen de **una sola lista** para
 * que nadie figure dos veces. «Cambia» es que el día sea el primero o el
 * último de su licencia, que es lo que alguien tiene que saber para organizar
 * el turno; el resto ya estaba afuera ayer y va a seguir mañana.
 */
export function repartirAusentesDelDia(
  ausentes: AusentePorHoy[],
  dia: string
): { empiezanOTerminan: AusentePorHoy[]; siguenAusentes: AusentePorHoy[] } {
  const cambia = (a: AusentePorHoy) =>
    a.fecha_desde.slice(0, 10) === dia || a.fecha_hasta.slice(0, 10) === dia;
  return {
    empiezanOTerminan: ausentes.filter(cambia),
    siguenAusentes: ausentes.filter((a) => !cambia(a)),
  };
}

/** Cómo se lee la situación de alguien en el día: «arranca hoy», «último día»… */
export function comoEstaEnElDia(a: AusentePorHoy, dia: string): string {
  const empieza = a.fecha_desde.slice(0, 10) === dia;
  const termina = a.fecha_hasta.slice(0, 10) === dia;
  if (empieza && termina) return "hoy solamente";
  if (empieza) return `arranca hoy, hasta el ${fechaCorta(a.fecha_hasta)}`;
  if (termina) return "último día, mañana se reintegra";
  return `hasta el ${fechaCorta(a.fecha_hasta)}`;
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
  if (partes.length) return `RR.HH. — novedades del ${fechaCorta(dia)}: ${partes.join(", ")}`;

  // Sin movimientos el asunto quedaba terminando en dos puntos y nada. Por el
  // cron no se ve nunca —sin movimientos no manda—, pero desde el botón de
  // «mandarlo ahora» sí: ahí lo manda una persona que ya vio lo que dice.
  const afuera = n.empiezanOTerminan.length + n.siguenAusentes.length;
  if (afuera) {
    return `RR.HH. — novedades del ${fechaCorta(dia)}: sin movimientos, ${plural(afuera, "persona ausente", "personas ausentes")}`;
  }
  return `RR.HH. — novedades del ${fechaCorta(dia)}: sin novedades`;
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
      n.vacaciones.map((v) => {
        const dias = Number(v.dias_tomados ?? NaN);
        const cuantos = isFinite(dias) ? `${dias} ${dias === 1 ? "día" : "días"}` : "? días";
        const cabeza = `- ${comoSeLlama(v.empleado)} — ${rangoDeFechas(v.fecha_desde, v.fecha_hasta)} · ${cuantos} · año ${v.anio_correspondiente ?? "?"}`;
        const detalle: string[] = [];
        if (v.observaciones?.trim()) detalle.push(`    Observaciones: ${sangrado(v.observaciones.trim(), "    ")}`);
        if (v.cargadaPor) detalle.push(`    La cargó: ${v.cargadaPor}`);
        return [cabeza, ...detalle].join("\n");
      })
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

  lineas.push(
    ...seccion(
      "Empiezan o terminan hoy",
      null,
      n.empiezanOTerminan.map(
        (a) => `- ${comoSeLlama(a.empleado)} — ${labelTipoAusencia(a.tipo)} · ${comoEstaEnElDia(a, dia)}`
      )
    )
  );

  lineas.push(
    ...seccion(
      "Siguen ausentes",
      null,
      n.siguenAusentes.map(
        (a) => `- ${comoSeLlama(a.empleado)} — ${labelTipoAusencia(a.tipo)} · ${comoEstaEnElDia(a, dia)}`
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
