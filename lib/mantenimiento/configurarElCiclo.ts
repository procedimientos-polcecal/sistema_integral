/**
 * Las reglas de la sección «Lo que crea órdenes solo».
 *
 * Lo que se puede leer de un ciclo y lo que se puede guardarle, sacado de la
 * pantalla para poder probarlo. El diseño está en
 * `docs/superpowers/specs/2026-11-24-mantenimiento-configurar-ot-automaticas-design.md`.
 */

import { comoSeLee } from "@/lib/core/fechas";
import { caraDeLaVuelta, type Decision } from "./cicloDeOT";
import { pareceUnCambio } from "./sospechaDeCambio";
import { ACCIONES_PREVENTIVAS } from "./tareasPreventivas";

/**
 * Qué va a hacer el ciclo, en una línea.
 *
 * Cubre las cuatro formas de `Decision`. `trabado` devuelve el motivo tal cual
 * y no lo envuelve: ese texto ya está escrito para que lo lea una persona, y
 * es el mismo que aparece en `/administracion/salud`.
 *
 * ── POR QUÉ `activo` ES OBLIGATORIO Y NO TIENE VALOR POR OMISIÓN ───────────
 *
 * Porque **el generador sólo mira los ciclos activos** (`generarEncadenadas`
 * filtra `activo = true`) y esta función no lo sabe sola. Hasta el 25/11/2026
 * la pantalla le pasaba la decisión de todos, así que la tarjeta de un ciclo
 * recién apagado decía «Apagado: no genera ninguna orden» y cuatro líneas
 * abajo «Crea «Rotación de Martillos» para el 27/11» — y esa frase se
 * congelaba, porque sin el generador el corte no se mueve nunca y la fecha se
 * va quedando en el pasado.
 *
 * Un valor por omisión de `true` dejaría que el próximo que llame a esto
 * herede la mentira sin elegirla. Es la misma razón por la que
 * `avisaALosInvitados()` es obligatorio en `lib/core/calendar.ts`.
 */
export function comoSeLeeLaDecision(
  d: Decision,
  tareas: { madre: string; hija: string },
  activo: boolean
): string {
  if (!activo) {
    return `Apagado: no crea ninguna orden. Si se prendiera: ${laFrase(d, tareas)}`;
  }

  return laFrase(d, tareas);
}

function laFrase(d: Decision, tareas: { madre: string; hija: string }): string {
  switch (d.que) {
    case "crear":
      return d.vuelta === 0
        ? `Crea «${tareas.madre}» para el ${comoSeLee(d.fecha_ejecucion)}`
        : `Crea «${tareas.hija}» — a ${caraDeLaVuelta(d.vuelta)} cara — para el ${comoSeLee(d.fecha_ejecucion)}`;
    case "esperar":
      return `Espera la OT ${d.ot}`;
    case "sin_arrancar":
      return "No arrancó, así que no genera ninguna orden";
    case "trabado":
      return d.porque;
  }
}

/**
 * Si el arranque automático puede ver a la madre de este ciclo.
 *
 * ── POR QUÉ ESTO HACE FALTA, Y NO ES UN DETALLE ────────────────────────────
 *
 * Un ciclo nace sin arrancar y arranca solo con el primer trabajo que **el
 * detector reconozca como un cambio de la pieza**. Y el detector no mira
 * `tarea_madre_id`: `elArranqueDeUnCambio()` llama a `pareceUnCambio()`, que
 * busca verbos de reemplazo —cambiar, reemplazar, recambiar, colocar, poner,
 * instalar— pegados al componente, y descarta a propósito las rotaciones.
 *
 * O sea que de las dieciséis acciones del vocabulario, sólo una madre que la
 * gente escriba como un reemplazo va a disparar el arranque. Un ciclo cuya
 * madre sea `LIMPIEZA` o `REVISION` **nace dormido para siempre**, y la
 * dormidera es invisible: una orden que nunca nace nunca se atrasa, así que
 * `mant-atrasadas-por-fecha` tampoco puede nombrarla.
 *
 * Por eso se avisa en vez de prohibir: prohibir acciones cerraría casos
 * legítimos, y la casa prefiere decir la verdad antes que adivinar.
 *
 * ── POR QUÉ LE PREGUNTA AL DETECTOR Y NO A UNA LISTA ───────────────────────
 *
 * Arma el texto que escribiría una persona —la etiqueta corta de la acción más
 * el componente— y se lo pasa a `pareceUnCambio()`. Una lista de claves acá
 * sería una segunda definición de lo mismo, que el día que el regex cambie
 * queda desfasada sin que nada avise.
 *
 * Y usa **el componente de este ciclo**, no uno de muestra: el detector
 * descarta las rotaciones de ese componente en particular, así que la
 * respuesta puede depender de cuál sea.
 */
export function arrancaSolo(accionMadre: string, componente: string): boolean {
  const accion = ACCIONES_PREVENTIVAS.find((a) => a.clave === accionMadre);
  if (!accion) return false;

  return pareceUnCambio(`${accion.corta} ${componente}`, componente);
}

/** Lo que se le puede cambiar a un ciclo ya armado. */
export interface Parametros {
  periodo_dias?: number | null;
  repeticiones?: number;
  especialidad?: string | null;
  horas_estimadas?: number | null;
  activo?: boolean;
  tarea_madre_id?: string;
  tarea_hija_id?: string;
}

/** El ciclo como está hoy, que es contra lo que se validan los cambios. */
export interface CicloComoEsta {
  repeticiones: number;
  vuelta_desde: number | null;
  tarea_madre_id: string;
  tarea_hija_id: string;
}

/**
 * Qué impide guardar estos parámetros. Vacío quiere decir que se puede.
 *
 * ── POR QUÉ LOS LÍMITES ESTÁN ACÁ Y NO SÓLO EN LA BASE ─────────────────────
 *
 * Porque los checks de `mant_ciclos_de_ot` y de `mant_tareas_preventivas` ya
 * los niegan, pero lo hacen con un 500 y un mensaje de Postgres. Esta pantalla
 * es la primera donde alguien puede cambiar el plazo y las repeticiones de un
 * ciclo —hasta hoy no se podían tocar—, así que es también la primera manera
 * de fabricar órdenes de más con un número mal tipeado. Los límites de abajo
 * son los mismos que los de la base, copiados a propósito.
 *
 * El que no es un check de la base es el de `vuelta_desde`: bajar las
 * repeticiones por debajo de la vuelta en curso **sí** rompe
 * `mant_ciclos_de_ot_vuelta`, pero lo que hay que decir no es eso sino en qué
 * vuelta está el ciclo.
 *
 * Informa **todos** los problemas juntos, como el resto del módulo.
 */
export function loQueImpideGuardar(p: Parametros, ciclo: CicloComoEsta): string[] {
  const problemas: string[] = [];

  if (p.repeticiones !== undefined) {
    if (!Number.isInteger(p.repeticiones) || p.repeticiones < 1 || p.repeticiones > 20) {
      problemas.push("Las repeticiones van de 1 a 20.");
    } else if (ciclo.vuelta_desde !== null && p.repeticiones < ciclo.vuelta_desde) {
      problemas.push(
        `El ciclo está en la vuelta ${ciclo.vuelta_desde}, así que no puede repetirse ` +
        `menos de ${ciclo.vuelta_desde} veces.`
      );
    }
  }

  // `Number.isInteger` y no `isFinite`: la columna es `integer`, y un
  // `<input type="number">` devuelve «1.5» igual. Sin esto la ruta contesta
  // 500 con el `invalid input syntax for type integer` de Postgres, que es
  // exactamente lo que esta función existe para no hacer.
  if (p.periodo_dias !== undefined && p.periodo_dias !== null) {
    if (!Number.isInteger(p.periodo_dias) || p.periodo_dias < 1 || p.periodo_dias > 3650) {
      problemas.push("El plazo va de 1 a 3650 días, en días enteros. Vaciarlo detiene el ciclo.");
    }
  }

  if (p.horas_estimadas !== undefined && p.horas_estimadas !== null) {
    if (!Number.isFinite(p.horas_estimadas) || p.horas_estimadas < 0) {
      problemas.push("Las horas estimadas no pueden ser negativas.");
    }
  }

  // Sólo cuando se mandan tareas: no mandarlas no es un cambio de tareas, y el
  // alta —que no tiene un ciclo contra el cual comparar— pasa ids vacíos.
  if (p.tarea_madre_id !== undefined || p.tarea_hija_id !== undefined) {
    const madre = p.tarea_madre_id ?? ciclo.tarea_madre_id;
    const hija = p.tarea_hija_id ?? ciclo.tarea_hija_id;
    if (madre === hija) {
      problemas.push("La tarea que se repite y la que cierra el ciclo tienen que ser distintas.");
    }
  }

  return problemas;
}

/**
 * Qué tareas se le pueden poner a cada lado del ciclo, y si cambiarlas es
 * posible siquiera.
 *
 * ── POR QUÉ CADA LADO EXCLUYE LA DEL OTRO ──────────────────────────────────
 *
 * Porque `mant_ciclos_de_ot_tareas_distintas` las rechaza, y ofrecerla igual
 * pone al final de un camino que arranca con un cartel que avisa que se tira
 * el estado del ciclo: se confirma lo irreversible y después aparece el error.
 *
 * ── Y POR QUÉ HACE FALTA DECIR QUE NO SE PUEDE ─────────────────────────────
 *
 * Medido el 25/11/2026: los cuatro ciclos de producción tienen **exactamente
 * dos** tareas confirmadas, las que plantó la semilla. Con dos, lo único que
 * cada desplegable podía ofrecer además de la propia era la del otro lado, así
 * que la salida de emergencia en la que se apoya todo el diseño no se podía
 * usar en 4 de 4 casos — y la pantalla no decía por qué. Lo que falta es una
 * tercera tarea confirmada en el catálogo del equipo.
 */
export function lasOpcionesDeTareas<T extends { id: string }>(
  tareas: readonly T[],
  par: { tarea_madre_id: string; tarea_hija_id: string }
): { madre: T[]; hija: T[]; sePuede: boolean } {
  return {
    madre: tareas.filter((t) => t.id !== par.tarea_hija_id),
    hija: tareas.filter((t) => t.id !== par.tarea_madre_id),
    sePuede: tareas.some(
      (t) => t.id !== par.tarea_madre_id && t.id !== par.tarea_hija_id
    ),
  };
}

/**
 * Lo que hay que escribirle al ciclo cuando se le cambia el par de tareas, o
 * `null` si el par no cambió.
 *
 * ── POR QUÉ CAMBIAR LAS TAREAS LO DEVUELVE A «SIN ARRANCAR» ────────────────
 *
 * Porque `desde` y `vuelta_desde` describen el par viejo. «La 2ª rotación el
 * 14/11» no quiere decir nada si la hija pasó a ser otra tarea, y dejarlo ahí
 * haría que el ciclo siguiera contando vueltas de un trabajo que ya no es el
 * suyo. El estado anterior no se puede traducir: se tira, y la pantalla lo
 * dice antes de guardar.
 *
 * ── Y POR QUÉ LAS TAREAS SE PUEDEN CAMBIAR ─────────────────────────────────
 *
 * Porque si no, no hay salida. `unique (equipment_id)` admite un solo ciclo
 * por equipo, no hay botón de borrar —borrarlo dejaría en null el `ciclo_id`
 * de todas sus órdenes— y el alta no ofrece equipos que ya tengan uno. Sin
 * esto, un equipo cuyo ciclo se apagó no podría tener otro nunca más.
 *
 * Las OT viejas conservan su `ciclo_id` y no molestan: el corte las deja
 * afuera, porque un ciclo sin arrancar no cuenta ninguna y, cuando arranque,
 * contará sólo desde esa fecha hacia adelante.
 *
 * Compara contra lo que el ciclo tiene hoy y no contra la presencia del campo:
 * mandar el mismo id no es un cambio.
 */
export function elResetPorCambioDeTareas(
  p: Parametros,
  ciclo: CicloComoEsta
): { desde: null; vuelta_desde: null } | null {
  const cambioLaMadre = p.tarea_madre_id !== undefined && p.tarea_madre_id !== ciclo.tarea_madre_id;
  const cambioLaHija = p.tarea_hija_id !== undefined && p.tarea_hija_id !== ciclo.tarea_hija_id;

  return cambioLaMadre || cambioLaHija ? { desde: null, vuelta_desde: null } : null;
}

/** Lo que se tipea para armar un ciclo nuevo. */
export interface AltaDeCiclo {
  equipment_id: string;
  componente: string;
  accionMadre: string;
  nombreMadre: string;
  accionHija: string;
  nombreHija: string;
  periodo_dias: number;
  repeticiones: number;
  especialidad: string | null;
  horas_estimadas: number | null;
}

/**
 * Qué falta o qué está mal en un alta. Vacío quiere decir que se puede.
 *
 * Los límites del plazo, las repeticiones y las horas no se repiten acá: los
 * pone `loQueImpideGuardar`, que es el mismo juego de números que valida una
 * edición. Lo que esta función agrega es lo que sólo existe en el alta —los
 * obligatorios, el vocabulario de acciones y el par de tareas—.
 *
 * ── EL CICLO SINTÉTICO QUE SE LE PASA A `loQueImpideGuardar` ───────────────
 *
 * En un alta no hay ciclo contra el cual comparar, así que va uno con los
 * campos en cero. **`p` no lleva `tarea_madre_id` ni `tarea_hija_id`**: la
 * comprobación de «madre y hija distintas» de aquella función corre sólo
 * cuando se le manda al menos uno de los dos, y mandar `""` en ambos la
 * dispararía en falso sobre un alta perfecta. Acá el mismo choque se
 * comprueba por el par `(acción, componente)`, que es la forma en que llegaría
 * a la base desde esta pantalla.
 *
 * ── POR QUÉ EL PAR Y NO LOS IDS ────────────────────────────────────────────
 *
 * La clave única de una tarea preventiva es `(equipment_id, accion,
 * componente)` y el alta usa **un solo componente** para las dos tareas, así
 * que dos acciones iguales resuelven al mismo upsert, o sea a la misma fila:
 * el ciclo nacería con `tarea_madre_id = tarea_hija_id` y lo rechazaría
 * `mant_ciclos_de_ot_tareas_distintas` con un 500.
 *
 * Informa **todos** los problemas juntos, como el resto del módulo.
 */
export function loQueFaltaParaArmar(datos: unknown): string[] {
  const d = (datos ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => String(v ?? "").trim();
  const numeroONada = (v: unknown): number | undefined => {
    if (v === null || v === undefined || texto(v) === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const problemas: string[] = [];

  if (!texto(d.equipment_id)) problemas.push("Falta el equipo.");

  // El componente es texto libre y está bien que lo sea: 62 de los 269 equipos
  // no tienen ninguno relevado, así que una lista cerrada dejaría a esos
  // equipos sin poder armar un ciclo.
  if (!texto(d.componente)) problemas.push("Falta el componente.");

  const cual = {
    Madre: "la tarea que cierra el ciclo",
    Hija: "la tarea que se repite",
  } as const;

  for (const lado of ["Madre", "Hija"] as const) {
    const accion = texto(d[`accion${lado}`]);
    if (!accion) problemas.push(`Falta la acción de ${cual[lado]}.`);
    else if (!ACCIONES_PREVENTIVAS.some((a) => a.clave === accion)) {
      problemas.push(`«${accion}» no es una acción del vocabulario.`);
    }

    if (!texto(d[`nombre${lado}`])) problemas.push(`Falta el nombre de ${cual[lado]}.`);
  }

  const plazo = numeroONada(d.periodo_dias);
  const repeticiones = numeroONada(d.repeticiones);

  if (plazo === undefined) problemas.push("Falta el plazo: cada cuántos días se repite la tarea.");
  if (repeticiones === undefined) {
    problemas.push("Faltan las repeticiones: cuántas veces se repite antes de volver a la madre.");
  }

  problemas.push(
    ...loQueImpideGuardar(
      {
        periodo_dias: plazo,
        repeticiones,
        horas_estimadas: numeroONada(d.horas_estimadas),
      },
      { repeticiones: 0, vuelta_desde: null, tarea_madre_id: "", tarea_hija_id: "" }
    )
  );

  const accionMadre = texto(d.accionMadre);
  if (accionMadre && accionMadre === texto(d.accionHija)) {
    problemas.push("La tarea que se repite y la que cierra el ciclo tienen que ser distintas.");
  }

  return problemas;
}

/**
 * La fila de `mant_tareas_preventivas` que escribe el alta de un ciclo.
 *
 * ── POR QUÉ LA MADRE NO LLEVA SIEMPRE `null` ───────────────────────────────
 *
 * Porque el alta hace `upsert` sobre la clave natural, o sea que **reusar una
 * tarea del catálogo reescribe su fila entera**. Escribirle `periodo_dias:
 * null` a la madre le borraba a esa tarea el período que había fijado la
 * pantalla del catálogo — y justo después de que el modal dijera «ya existe
 * X, cada N días: el ciclo la reusa» (revisión del 25/11/2026).
 *
 * El plazo del ciclo es el de la **hija**: es cada cuánto se repite. Cuándo
 * vuelve la madre lo decide la cuenta de vueltas y no un período propio, así
 * que una madre nueva nace en null, como la semilla.
 *
 * `motivo: null` es la regla de la ruta del catálogo, donde está explicada:
 * una confirmada no conserva el motivo de cuando se la descartó.
 */
export function elUpsertDeLaTarea(datos: {
  lado: "madre" | "hija";
  equipment_id: string;
  accion: string;
  componente: string;
  nombre: string;
  periodo_dias: number;
  existente: { periodo_dias: number | null } | null;
}): {
  equipment_id: string; accion: string; componente: string; nombre: string;
  estado: "CONFIRMADA"; periodo_dias: number | null; motivo: null;
} {
  return {
    equipment_id: datos.equipment_id,
    accion: datos.accion,
    componente: datos.componente,
    nombre: datos.nombre,
    estado: "CONFIRMADA",
    periodo_dias: datos.lado === "hija"
      ? datos.periodo_dias
      : datos.existente?.periodo_dias ?? null,
    motivo: null,
  };
}

/** Lo que contesta el alta cuando ese equipo ya tiene un ciclo. */
export const YA_TIENE_CICLO =
  "Ese equipo ya tiene un ciclo. Si está apagado, se prende desde su tarjeta.";

/**
 * Los choques contra un `unique` que esta pantalla puede provocar, con lo que
 * hay que decir en cada caso.
 */
const CHOQUES: readonly { constraint: string; mensaje: string }[] = [
  { constraint: "mant_ciclos_de_ot_un_ciclo_por_equipo", mensaje: YA_TIENE_CICLO },
];

/**
 * El mensaje de un choque contra un `unique` de la base, o `null` si el error
 * no es eso.
 *
 * ── POR QUÉ HACE FALTA, SI YA HAY VALIDACIÓN ───────────────────────────────
 *
 * Porque el alta sólo ofrece equipos sin ciclo, y esa lista la arma la página
 * al cargarse. Dos pestañas abiertas, o una página vieja, alcanzan para
 * mandar un equipo que entre medio recibió uno. Ése es el único camino que la
 * validación no puede cubrir, y lo que llega tiene que ser una frase y no el
 * texto de Postgres.
 *
 * **Mira el nombre de la constraint y no sólo el `23505`**: traducir cualquier
 * choque con este mensaje diría que el equipo ya tiene ciclo cuando lo
 * repetido fue otra cosa, y mandaría a mirar donde no hay nada.
 */
export function elMensajeDelChoque(error: { code?: string; message?: string }): string | null {
  if (error?.code !== "23505") return null;

  const mensaje = error.message ?? "";
  return CHOQUES.find((c) => mensaje.includes(c.constraint))?.mensaje ?? null;
}

/**
 * Cada cuánto corre un mantenimiento programado, el **otro** motor de OT
 * automáticas.
 *
 * Las etiquetas viven acá y no en la pantalla de programados porque las miran
 * las dos: la sección de Configuración las lista y aquella las ofrece en su
 * formulario. Un tipo que no esté en la lista se muestra crudo en vez de
 * desaparecer — una fila sin texto se lee como «no tiene programa», que es
 * otra cosa.
 */
export const PROGRAMAS: readonly { value: string; label: string }[] = [
  { value: "DIARIO", label: "Diario" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "QUINCENAL", label: "Quincenal" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "TRIMESTRAL", label: "Trimestral" },
  { value: "SEMESTRAL", label: "Semestral" },
  { value: "ANUAL", label: "Anual" },
  { value: "PERSONALIZADO", label: "Personalizado (días)" },
  { value: "FECHA_FIJA", label: "Fecha fija (única)" },
];

export function comoSeLeeElPrograma(
  scheduleType: string,
  intervalDays: number | null
): string {
  const etiqueta = PROGRAMAS.find((p) => p.value === scheduleType)?.label ?? scheduleType;
  return intervalDays ? `${etiqueta} · cada ${intervalDays} días` : etiqueta;
}
