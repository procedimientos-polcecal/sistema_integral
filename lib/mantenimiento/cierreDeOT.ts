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
import { justificacionQueExplica } from "@/lib/core/justificacion";

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
/**
 * Dar una orden por realizada exige decir **cuándo** se terminó.
 *
 * ── POR QUÉ NO ALCANZABA CON `loQueFaltaParaCerrar` ────────────────────────
 *
 * Porque aquélla sólo habla **cuando hay fecha de cierre**: sin fecha
 * devuelve `[]`, a propósito, porque en el alta una orden que todavía no se
 * hizo no tiene por qué traer horas ni operarios. El agujero que deja es
 * exactamente el que esto cierra: una orden que pasa a `REALIZADO` **sin**
 * fecha no dispara ninguna regla, y queda dicha por hecha sin decir qué día.
 *
 * ── LO QUE SE MIDIÓ, QUE ES LO QUE DECIDE DÓNDE PUEDE IR ───────────────────
 *
 * El 16/11/2026, sobre las 2.466 órdenes: **220 de las 2.415 realizadas no
 * tienen fecha de cierre (9,1 %)**, y de esas 220 **una sola la creó la app**.
 * O sea que el hueco no está en la pantalla sino en lo que entra por la
 * planilla — y ahí no se puede exigir nada, porque la planilla manda y la
 * sincronización importa lo que haya.
 *
 * Por eso la regla **no** es «toda orden realizada tiene fecha». Es más chica
 * y se puede sostener: **un pedido que pone una orden en `REALIZADO` tiene que
 * decir el día.** Las 219 de la planilla quedan como están; lo que no vuelve a
 * pasar es que la app cree una.
 *
 * ── Y POR QUÉ MIRA EL ESTADO Y NO EL RESULTADO DE LA PANTALLA ──────────────
 *
 * Porque el modal de «Registrar el trabajo» manda la fecha en los tres casos
 * —completado, parcial y cancelado—, y sólo el primero termina en `REALIZADO`.
 * Ahí la fecha es obligatoria igual, pero por otro motivo: es la fecha de la
 * **ejecución**, que se guarda siempre. Esa obligación es de la pantalla; ésta
 * es la del estado, y son dos cosas que conviene no mezclar.
 */
export function loQueFaltaParaDarPorRealizada(
  estado: string | null | undefined,
  fechaCierre: string | null | undefined
): string[] {
  if (String(estado ?? "").trim().toUpperCase() !== "REALIZADO") return [];
  return cargado(fechaCierre) ? [] : ["la fecha de cierre"];
}

/**
 * Con qué fecha de cierre **queda** la orden después de un pedido: la que vino
 * si vino, y la guardada si no.
 *
 * ── POR QUÉ ESTO ES UNA FUNCIÓN Y NO UN `??` ───────────────────────────────
 *
 * Porque `??` contesta mal en un caso que pasa. El PATCH de órdenes miraba
 * `body.fecha_cierre ?? laGuardada`, y con `fecha_cierre: ""` en el cuerpo el
 * `??` lo deja pasar como valor —el vacío no es `null` ni `undefined`—, así que
 * la orden quedaba evaluándose contra una fecha que no es con la que iba a
 * quedar. Lo que decide es **si la clave vino**, y eso no se puede deducir del
 * valor después de que `repartirRegistroDeOT` lo normalizó a `body.x || null`:
 * para ahí, «no vino» y «vino vacía» son el mismo `null`. De ahí el booleano
 * aparte, que es el único que sabe la diferencia.
 *
 * ── Y POR QUÉ IMPORTA QUE SEA UNA SOLA ─────────────────────────────────────
 *
 * Porque cuatro reglas distintas miran esa fecha —las tres del cierre y la de
 * cancelar—, y dos nociones de «la fecha que decide» en la misma ruta es
 * exactamente cómo una de las dos se queda vieja sin que nada avise. El caso
 * vivo que lo mostró: «Registrar el trabajo» con resultado **Parcial** deja la
 * orden `EN_PROCESO` **con** `fecha_cierre`; cancelarla después pasaba la regla
 * —el cuerpo no trae fecha— y dejaba una `CANCELADA` con fecha de cierre, que
 * es la fila que `costoEquipo` cobra como gasto real.
 *
 * El `String()` no es una formalidad: lo que llega es lo que mandó el cuerpo
 * sin que nadie le mire el tipo, y un `fecha_cierre: 5` termina en el `.slice()`
 * de quien la consuma — un TypeError y un 500 tapando el 400 que ya estaba bien.
 */
export function elCierreQueQueda(
  vinoEnElPedido: boolean,
  loQueVino: unknown,
  laGuardada: string | null
): string | null {
  if (!vinoEnElPedido) return laGuardada;
  return loQueVino === null || loQueVino === undefined ? null : String(loQueVino);
}

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

/**
 * Qué le impide a una orden darse por cerrada en esa fecha.
 *
 * Es **otra clase de problema** que `loQueFaltaParaCerrar`, y por eso va
 * aparte: aquello dice que falta un dato, y esto que los datos que hay no se
 * sostienen entre ellos. Un «Falta cargar la fecha de inicio» cuando lo que
 * pasa es que el cierre quedó antes manda a buscar lo que no es.
 *
 * Dos cosas, y las dos son la misma: **un trabajo no se cierra antes de
 * empezar.**
 *
 * 1. **Sin fecha de inicio no se puede cerrar.** No es una formalidad: de esa
 *    fecha salen el atraso, el MTBF y la ventana del equipo, y una orden que
 *    dice cuándo terminó pero no cuándo empezó no se puede contar en ninguno
 *    de los tres. Medido el 05/11/2026 sobre las 2.417 órdenes: **0 de las
 *    2.143 cerradas están así** y hay una sola orden en todo el sistema sin
 *    fecha de inicio, abierta. O sea que esto no traba nada de lo que hay —
 *    cierra el agujero antes de que entre la primera.
 * 2. **El cierre no puede ser anterior al inicio.** Ésa sí pasa: 63 de las
 *    2.143 cerradas lo están, y no de a un día —la 2568 arranca el 16/11 y
 *    cierra el 07/10, la 1671 arranca el 03/05 y cierra el 03/02, que tiene
 *    toda la cara de un d/m leído al revés—. Nada las detectaba, porque cada
 *    fecha por separado es perfectamente válida.
 *
 * **Las dos fechas en el mensaje**, igual que en `loQueSeContradice`: decir
 * sólo «el cierre es anterior» obliga a volver al formulario a ver contra
 * qué, y la que está mal puede ser cualquiera de las dos.
 *
 * Sin fecha de cierre devuelve `[]` y no mira nada: no se está cerrando.
 *
 * ── QUÉ CEDIÓ EL 12/11/2026, Y QUÉ NO ──────────────────────────────────────
 *
 * **Cede la segunda regla y sólo ella**, a pedido: «quiero que se pueda poner
 * una fecha de cierre de una OT anterior a su fecha de inicio, pero que te
 * pida una justificación obligatoria si eso ocurre». O sea que el bloqueo no
 * desaparece: se cambia por una guarda. Si el texto pasa
 * `justificacionQueExplica`, la fecha se acepta; sin él, o con un «no» o una
 * «x», sigue saliendo el mismo mensaje de siempre.
 *
 * **Las mediciones de arriba siguen siendo ciertas y por eso no se borran**:
 * son el porqué de que la regla naciera el 05/11/2026 y siguen siendo el
 * porqué de que ahora se pida una explicación en vez de dejarlo pasar. Lo que
 * cambió no es el dato sino qué se hace con él: antes esas 63 no se podían
 * repetir, ahora se pueden y queda escrito por qué.
 *
 * **La primera regla no se toca**, y no por omisión: cerrar sin fecha de
 * inicio no es lo que se pidió dar vuelta, y una justificación no reemplaza a
 * la fecha de la que salen el atraso, el MTBF y la ventana del equipo —no hay
 * texto que haga calculable un intervalo sin extremo—. Con justificación o sin
 * ella, esa rama sigue devolviendo lo mismo.
 *
 * El tercer parámetro es **opcional** a propósito: los llamadores que no están
 * cerrando nada no tienen justificación que pasar, y sin él la función se
 * comporta exactamente como antes del 12/11/2026.
 */
export function loQueImpideCerrar(
  fechaInicio: string | null | undefined,
  fechaCierre: string | null | undefined,
  justificacion?: string | null | undefined
): string[] {
  const cierre = String(fechaCierre ?? "").trim();
  if (!cierre) return [];

  const inicio = String(fechaInicio ?? "").trim();
  if (!inicio) {
    return ["la orden no dice cuándo empezó, y un trabajo no se cierra antes de empezar"];
  }

  if (cierre >= inicio) return [];
  if (justificacionQueExplica(justificacion)) return [];

  return [`la fecha de cierre (${cierre}) es anterior a la de inicio (${inicio})`];
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
  /** Opcional: los generadores automáticos no tienen justificación que mandar. */
  cierre_justificacion?: string | null;
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
  // ── «POR HACER» TAMBIÉN SE EXPORTA, DESDE EL 29/10/2026 ──────────────────
  //
  // Era el único estado que no viajaba, y el motivo escrito acá era que «la M
  // trae `=IF(J="","",L)` y escribirle "Por hacer" la reemplazaría por un
  // literal». **Ese motivo era falso.** Medido sobre la columna entera: la M
  // no tiene fórmula de columna —2.291 de 2.299 celdas son literales y sólo
  // cinco sueltas llevan ese `=IF(...)`—; la fórmula de verdad es la L, una
  // `ARRAYFORMULA` en L3.
  //
  // Así que no exportar no dejaba la celda calculándose: la dejaba en blanco.
  // Al 29/10/2026 eran ocho órdenes sin estado en la planilla, dos de ellas ya
  // atrasadas. Ahora viaja, y lo que se escribe es la fórmula de esa fila —ver
  // `celdaDeEstado`—, así que la celda se sigue actualizando sola.
  if (estado) registro.estado = estado;

  if (cargado(orden.fecha_cierre)) registro.fecha_cierre = orden.fecha_cierre;
  // Cero horas es un dato —hay trabajos de minutos— y tiene que llegar.
  if (orden.horas !== null && orden.horas !== undefined) registro.horas = orden.horas;
  if (cargado(orden.contratista)) registro.contratista = orden.contratista;
  if (cargado(orden.operario_1)) registro.operario_1 = orden.operario_1;
  if (cargado(orden.operario_2)) registro.operario_2 = orden.operario_2;
  if (cargado(orden.operario_3)) registro.operario_3 = orden.operario_3;
  if (cargado(orden.cierre_justificacion)) registro.cierre_justificacion = orden.cierre_justificacion;

  // Si lo único que hay es el estado por hacer, no hay nada que exportar: las
  // horas y los operarios tienen que poder viajar solos, sin el estado.
  return Object.keys(registro).length > 0 ? registro : null;
}
