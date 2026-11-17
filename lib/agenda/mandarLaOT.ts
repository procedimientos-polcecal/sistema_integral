import type { SupabaseClient } from "@supabase/supabase-js";
import type { Turno } from "@/lib/mantenimiento/programacion";
import { traerTodo } from "@/lib/core/paginado";
// La misma que usan `alNacerLaOT` y el barrido: la elección de candidatas
// depende de que las tres digan el mismo «hoy».
import { hoyEnArgentina } from "@/lib/core/fechas";
import {
  INVITADOS_DE_UNA_OT, advertenciaDeReenviarDivergido, datosDeLaOT, faltaConfirmarElPisado,
  fechaParaElCalendario, horarioDeLaOT, problemasDeMandarLaOT, problemasDelEvento,
} from "./evento";
import { AVISO_DE_TOPE, claveDelHueco, horarioApilado } from "./apilado";
import { AVISO_DE_BORRADO } from "./elEventoSigueALaOT";
import { esCandidataAlCalendario } from "./candidata";
import { aInstanteISO, eventoParaGoogle, invitadosLimpios } from "./pedido";
import {
  escribirEnGoogle, columnasDespuesDeEscribir, advertenciaDeLaEscritura, parDivergencia, parPendiente,
} from "./escribirEnGoogle";
import { agregarInvitados, sacarInvitados, diferenciaDeInvitados } from "./invitados";
import { anotarEnLaFila } from "./cargar";
import { elegirElDuenoDeLaOT } from "./duenoDeLaOT";
import { ES_UUID } from "./sesion";

/**
 * Mandar una OT al calendario: se elige el horario, el evento arranca con él y
 * dura 1:30. Vuelve a mandarla y **reemplaza**: `agenda_eventos.ot_id` es
 * `unique`, así que una OT tiene un solo evento y cambiarle el turno lo mueve.
 *
 * Esto vivía adentro del `POST` de
 * `app/api/mantenimiento/ordenes/[id]/calendario` y salió de ahí el 04/11/2026,
 * sin cambiarle nada, porque **seis caminos más lo necesitan** —el alta de una
 * OT, el barrido de después de la sincronización, el envío desde el plan del
 * día y el script de arranque— y ninguno tiene una pantalla detrás. Por eso no
 * sabe de `Request` ni de `NextResponse`: devuelve un `estado` y quien llama
 * decide si eso es un 409 en la pantalla o un renglón en un informe.
 *
 * ── EL EVENTO ES DE LA ORDEN, NO DE QUIEN APRIETA EL BOTÓN ──────────────────
 *
 * Con el alta, el dueño es la casilla que generó la OT (`created_by`) y, si no
 * la tiene —el 96 % de las OT, medido el 03/11/2026: los números están en
 * `duenoDelEventoDeLaOT`—, `mantenimiento@`. Con un evento que ya existía,
 * **el dueño no cambia**, aunque lo reenvíe otra persona u otra casilla. Por eso
 * se escribe con el cliente admin y no con el de la sesión: la policy de editar
 * sólo deja al dueño, y el insert sólo deja crear a nombre propio. El permiso lo
 * comprueba quien llama.
 *
 * ── EL TURNO EXPLÍCITO ES EL BOTÓN; SIN TURNO SE CALCULA EL HUECO ───────────
 *
 * Con `turno`, el horario sale de ese turno (`horarioDeLaOT`) y la validación es
 * la del botón: `problemasDeMandarLaOT`, que exige un turno del taller y no mira
 * si la fecha ya pasó —mandar a mano una orden de ayer es una decisión de una
 * persona—.
 *
 * Con `turno: null` el pedido es automático: lo decide
 * `esCandidataAlCalendario` (no cerrada, con fecha válida y de hoy en
 * adelante), y el horario sale de `horarioApilado`, que apila las de la misma
 * especialidad de a 1:30 desde las 08:00. **El turno que se guarda igual es
 * `8-16`**, que es el que el usuario eligió para las automáticas: la columna
 * dice a qué turno pertenece el evento y es lo que `seguirALasOT` usa para
 * reubicarlo si la OT cambia de fecha. Dejarla en null haría que ese barrido se
 * negara a mover el evento, o sea un evento que deja de seguir a su orden.
 *
 * ── LA FECHA ─────────────────────────────────────────────────────────────────
 *
 * Manda `fecha_ejecucion_pendiente` cuando la hay (`fechaParaElCalendario`).
 * Una OT sin ninguna fecha no se manda: es un 400 con el motivo. La fecha se
 * valida antes de guardar nada, porque `horarioDeLaOT` no lo hace y una mal
 * formada haría que cada aviso de Google saliera «movido» para siempre.
 *
 * ── EL ORDEN ─────────────────────────────────────────────────────────────────
 *
 * Como el alta de la Agenda: la fila, después los invitados, después Google. El
 * SdG es el dueño del dato y un fallo de Google **no** deshace el evento: queda
 * `google_pendiente` y la respuesta lo dice. Los invitados van **en otra
 * sentencia** que el evento, nunca en la misma: la policy de `agenda_invitados`
 * no ve un evento insertado en la misma sentencia (`42501`).
 *
 * Se escribe en Google siempre con `crear`, que es idempotente: si el evento ya
 * estaba lo pisa entero, y si estaba borrado lo resucita. Mandar una OT es una
 * orden explícita de que el evento esté donde dice el SdG, así que **resuelve
 * una divergencia** en vez de respetarla (lo que el SdG no hace es pisar solo,
 * y esto no es solo). **Pero sabiendo**: con el evento divergido el pedido
 * tiene que traer `pisar: true` o contesta 409 (`faltaConfirmarElPisado`), y el
 * modal lo pide mostrando antes qué horario tiene Google hoy. Mandarlo a
 * destrabar sería un callejón sin salida: destrabar es del dueño, y el dueño va
 * a ser `mantenimiento@`, no quien aprieta. **Un proceso automático nunca pisa**:
 * manda `pisar: false` y se queda con el 409.
 *
 * Una OT con `fecha_cierre` no se manda: sería un evento futuro de algo que pasó.
 */

/** El turno con el que se guardan las órdenes que entran solas (decisión 6 del diseño). */
export const TURNO_AUTOMATICO: Turno = "8-16";

export interface PedidoDeMandar {
  /** Null = automático: se calcula el hueco. Un turno explícito es el botón manual. */
  turno: Turno | null;
  invitadosExtra: string[];
  /** Confirmación de pisar un evento divergido. El automático nunca pisa. */
  pisar: boolean;
}

export type ResultadoDeMandar =
  | {
      ok: true;
      eventoId: string;
      reemplazo: boolean;
      /** El instante en que arranca, como quedó guardado. */
      inicio: string;
      enGoogle: boolean;
      pendiente: string | null;
      advertencias: string[];
    }
  | { ok: false; estado: 400 | 404 | 409 | 500; error: string; requiereConfirmacion?: boolean };

const mal = (estado: 400 | 404 | 409 | 500, error: string): ResultadoDeMandar => ({ ok: false, estado, error });

/** Lo que de un evento del día hace falta para saber en qué grupo cae. */
interface EventoDelDia {
  ot_id: string | null;
  turno: string | null;
  ordenes_trabajo:
    | { especialidad: string | null }
    | { especialidad: string | null }[]
    | null;
}

/**
 * Cuántos eventos de OT del mismo grupo ya hay ese día. **Quien barre no cuenta
 * por su cuenta ni adelanta nada**, deja que esta función haga la cuenta, que es
 * lo que evita dos criterios para lo mismo. Se exporta para que la corrida en
 * seco de `scripts/mandar-las-ot-futuras.mts` pregunte lo mismo que va a
 * preguntar la de verdad, y por eso no se reescribe allá. Y no hay nada que
 * adelantar: cada orden se escribe antes de contar la siguiente, así que la
 * base ya tiene la anterior (ver el encabezado de `barridoDeNuevas`).
 *
 * El grupo es el de `claveDelHueco` —día, especialidad **y turno**—, la misma
 * definición que usa el barrido de `elEventoSigueALaOT`. Con dos claves
 * distintas, el mismo evento recibía un hueco distinto según cuál de los dos
 * caminos lo tocó último.
 *
 * El día se recorta del lado del servidor con el instante de su medianoche de
 * Argentina y el de la siguiente —Argentina no tiene horario de verano, así que
 * son 24 horas exactas—, para no traerse la tabla entera cada vez que nace una
 * orden. El grupo se compara acá y armando la clave entera de los dos lados,
 * porque `claveDelHueco` normaliza la especialidad; y **el evento de la propia
 * orden no cuenta**: al reenviarla se correría sola.
 */
export async function huecosOcupados(
  admin: SupabaseClient,
  fecha: string,
  especialidad: string | null | undefined,
  turno: Turno,
  exceptoLaOrden: string
): Promise<number> {
  const clave = claveDelHueco(fecha, especialidad, turno);
  const desde = aInstanteISO(`${fecha}T00:00:00`);
  if (!desde) throw new Error(`La fecha «${fecha}» no se pudo convertir a un instante`);
  const hasta = new Date(Date.parse(desde) + 24 * 60 * 60 * 1000).toISOString();

  const filas = await traerTodo<EventoDelDia>((d, h) =>
    admin
      .from("agenda_eventos")
      // La cadena va literal y en una sola pieza: partida con `+` pierde la
      // inferencia de tipos de Supabase.
      .select("ot_id, turno, ordenes_trabajo!ot_id(especialidad)")
      .not("ot_id", "is", null)
      .gte("inicio", desde)
      .lt("inicio", hasta)
      .order("id")
      .range(d, h)
      .returns<EventoDelDia[]>()
  );

  return filas.filter((f) => {
    if (!f.ot_id || f.ot_id === exceptoLaOrden || !f.turno) return false;
    const orden = Array.isArray(f.ordenes_trabajo) ? f.ordenes_trabajo[0] : f.ordenes_trabajo;
    return claveDelHueco(fecha, orden?.especialidad, f.turno) === clave;
  }).length;
}

export async function mandarLaOTAlCalendario(
  admin: SupabaseClient,
  ordenId: string,
  pedido: PedidoDeMandar,
  ahora: Date = new Date()
): Promise<ResultadoDeMandar> {
  if (!ES_UUID.test(ordenId)) return mal(404, "No existe esa orden");

  const marca = ahora.toISOString();

  const { data: orden, error: errorDeOrden } = await admin
    .from("ordenes_trabajo")
    // La cadena va literal y en una sola pieza: partida con `+` pierde la
    // inferencia de tipos de Supabase.
    .select("id, ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_cierre, estado, created_by, equipo_raw, equipo_code, sector_raw, especialidad, tipo, descripcion")
    .eq("id", ordenId)
    .maybeSingle();
  if (errorDeOrden) return mal(500, `No se pudo leer la orden: ${errorDeOrden.message}`);
  if (!orden) return mal(404, "No existe esa orden");

  // ── ¿Ya tenía evento? Entonces el dueño es el que ya es ───────────────────
  const { data: actual, error: errorDeEvento } = await admin
    .from("agenda_eventos")
    .select("id, dueno_id, casilla, google_event_id, divergencia, aviso")
    .eq("ot_id", ordenId)
    .maybeSingle();
  if (errorDeEvento) return mal(500, `No se pudo leer el evento de la orden: ${errorDeEvento.message}`);

  let dueno: { id: string; casilla: string };
  if (actual) {
    dueno = { id: actual.dueno_id, casilla: actual.casilla };
  } else {
    const elegido = await elegirElDuenoDeLaOT(admin, orden.created_by ?? null);
    if (!elegido.ok) return mal(500, elegido.error);
    if (elegido.id) {
      dueno = { id: elegido.id, casilla: elegido.casilla };
    } else {
      // Sin `created_by`: es la casilla del área, y `dueno_id` pide un usuario.
      // `ilike` y no `eq`: el correo se guardó como lo tipeó quien creó el
      // usuario, y la casilla es minúscula. Y sólo uno activo: si esa casilla se
      // desactiva, el evento quedaría a nombre de alguien que ya no está y nadie
      // lo notaría. (La casilla no lleva `%` ni `_`: `ilike` la toma literal.)
      const { data: delArea, error: errorDelArea } = await admin
        .from("usuarios")
        .select("id")
        .ilike("email", elegido.casilla)
        .eq("activo", true)
        .maybeSingle();
      if (errorDelArea) {
        return mal(500, `No se pudo buscar al usuario ${elegido.casilla}: ${errorDelArea.message}`);
      }
      if (!delArea) {
        return mal(
          409,
          `Esta orden no tiene quién la haya generado, así que su evento es de ${elegido.casilla}, ` +
            `pero en el SdG no hay un usuario activo con ese correo. Hay que crearlo o reactivarlo antes de mandarla.`
        );
      }
      dueno = { id: delArea.id, casilla: elegido.casilla };
    }
  }

  // ── Validar todo junto, antes de guardar nada ─────────────────────────────
  const extras = pedido.invitadosExtra.map((c) => c.trim()).filter((c) => c !== "");
  let fechaElegida: string;
  if (pedido.turno !== null) {
    const delPedido = problemasDeMandarLaOT({
      fecha_ejecucion: fechaParaElCalendario(orden), turno: pedido.turno, invitados: extras,
      fecha_cierre: orden.fecha_cierre, estado: orden.estado,
    });
    if (delPedido.length > 0) return mal(400, delPedido.join(" "));
    fechaElegida = fechaParaElCalendario(orden) as string;
  } else {
    const candidata = esCandidataAlCalendario(orden, hoyEnArgentina(ahora));
    if (!candidata.ok) return mal(400, candidata.motivo);
    fechaElegida = candidata.fecha;
  }

  // Pisar un evento que alguien tocó en Google se hace sabiendo (ver la función).
  const sinConfirmar = faltaConfirmarElPisado(actual?.divergencia, pedido.pisar);
  if (sinConfirmar) return { ok: false, estado: 409, error: sinConfirmar, requiereConfirmacion: true };

  // ── El horario ────────────────────────────────────────────────────────────
  const turno = pedido.turno ?? TURNO_AUTOMATICO;
  let horario: { inicio: string; fin: string };
  let topeado = false;
  if (pedido.turno !== null) {
    horario = horarioDeLaOT(fechaElegida, pedido.turno);
  } else {
    let ocupados: number;
    try {
      ocupados = await huecosOcupados(admin, fechaElegida, orden.especialidad, turno, ordenId);
    } catch (e) {
      return mal(500, `No se pudo contar lo que ya hay en el calendario del ${fechaElegida}: ${(e as Error).message}`);
    }
    const apilado = horarioApilado(fechaElegida, ocupados);
    if (!apilado) {
      // No debería pasar: `esCandidataAlCalendario` ya validó la fecha.
      return mal(500, `No se pudo calcular el horario del ${fechaElegida}: es un error del SdG, no de Google`);
    }
    horario = { inicio: apilado.inicio, fin: apilado.fin };
    topeado = apilado.topeado;
  }

  const texto = datosDeLaOT(orden);
  const invitados = invitadosLimpios([...INVITADOS_DE_UNA_OT, ...extras], dueno.casilla);
  const delEvento = problemasDelEvento({ titulo: texto.titulo, inicio: horario.inicio, fin: horario.fin, invitados });
  if (delEvento.length > 0) return mal(400, delEvento.join(" "));

  const inicio = aInstanteISO(horario.inicio);
  const fin = aInstanteISO(horario.fin);
  if (!inicio || !fin) {
    // No debería pasar: `problemasDelEvento` ya los habría rechazado.
    return mal(400, "El inicio o el fin no es una fecha y hora válida");
  }

  const eventoId = actual?.id ?? crypto.randomUUID();
  const fila = { id: eventoId, titulo: texto.titulo, descripcion: texto.descripcion, lugar: texto.lugar, inicio, fin };
  const advertencias: string[] = [];
  if (topeado) advertencias.push(AVISO_DE_TOPE);
  // El tope va a `aviso` y **nunca a `google_pendiente`**: es algo que mirar, no
  // algo que todavía falte escribir, y el cron de pendientes no lo levanta. La
  // advertencia de arriba no alcanza: en el camino automático no hay pantalla
  // que la lea —`alNacerLaOT` devuelve un texto y el importador no tiene a quién
  // mostrárselo—, así que la copia en la columna **es** el canal.
  //
  // Sin tope se limpia **sólo si lo guardado es el aviso del tope**. Limpiar a
  // ciegas pisaría el de un borrado que Google rechazó, que es lo único que dice
  // que quedó un evento vivo en cinco calendarios. La columna tiene tres
  // escritores en un evento de OT —el borrado fallido y el tope, que son los dos
  // que ésta nombra, y el que escribe la sincronización cuando la fecha de la
  // orden se vació o el evento divergió (`avisar` y `respetar`)— y cada uno limpia
  // lo suyo (ver `limpiable` en `elEventoSigueALaOT.ts`, que es la otra mitad de
  // esta regla).
  //
  // **Y el aviso de un borrado fallido gana también contra el del tope**, que
  // es el caso que faltaba: escribirlo encima lo perdía igual que limpiarlo a
  // ciegas. No son dos comodidades equivalentes —el del borrado es el único
  // registro de un evento que quedó vivo en cinco calendarios y que ya ninguna
  // fila nombra; el del tope es que una orden comparte las 20:00, que se vuelve
  // a deducir del horario—. Es la misma regla que `avisoDeUnMovimiento`.
  const deUnBorradoFallido = actual?.aviso?.startsWith(AVISO_DE_BORRADO) ?? false;
  const delTope = deUnBorradoFallido
    ? {}
    : topeado
      ? { aviso: AVISO_DE_TOPE }
      : actual?.aviso === AVISO_DE_TOPE
        ? { aviso: null }
        : {};

  if (actual) {
    // ── Reemplazar: se mueve al turno nuevo, no se duplica ──────────────────
    const { data: guardadas, error } = await admin
      .from("agenda_eventos")
      .update({ ...fila, turno, ...delTope })
      .eq("id", eventoId)
      .select("id");
    if (error) return mal(500, `No se pudo guardar el evento: ${error.message}`);
    if (!guardadas || guardadas.length === 0) {
      return mal(409, "El evento se borró mientras tanto. Volvé a mandar la orden.");
    }

    const { data: actuales, error: errorDeInvitados } = await admin
      .from("agenda_invitados")
      .select("email")
      .eq("evento_id", eventoId);
    const falloDeInvitados = errorDeInvitados
      ? `No se pudieron leer los invitados: ${errorDeInvitados.message}`
      : await cambiarInvitados(admin, eventoId, (actuales ?? []).map((i: { email: string }) => i.email.toLowerCase()), invitados);
    if (falloDeInvitados) {
      // La fila ya va adelantada de Google: sin pendiente nada lo registra.
      const sinAnotar = await anotarEnLaFila(
        admin,
        eventoId,
        parPendiente(
          `El evento de la OT se movió en el SdG pero no los invitados, y Google no recibió nada: ${falloDeInvitados}`,
          marca
        )
      );
      return mal(
        500,
        `${falloDeInvitados}. El horario sí se guardó en el SdG, pero todavía no está en Google: quedó pendiente.` +
          (sinAnotar ? ` Ojo: tampoco se pudo anotar el pendiente (${sinAnotar}), así que volvé a mandar la orden.` : "")
      );
    }
  } else {
    // ── Alta ────────────────────────────────────────────────────────────────
    const { error } = await admin
      .from("agenda_eventos")
      .insert({ ...fila, ...delTope, dueno_id: dueno.id, casilla: dueno.casilla, ot_id: ordenId, turno });
    if (error) {
      // `ot_id` es único: otra persona la mandó en este mismo instante.
      if (error.code === "23505") {
        return mal(
          409,
          "Alguien acaba de mandar esta orden al calendario. Volvé a intentarlo para moverla al turno que elegiste."
        );
      }
      return mal(500, `No se pudo guardar el evento: ${error.message}`);
    }

    // Sentencia aparte: ver el encabezado.
    const sinInvitados = await agregarInvitados(admin, eventoId, invitados);
    if (sinInvitados) {
      const { error: errorAlDeshacer } = await admin.from("agenda_eventos").delete().eq("id", eventoId);
      return mal(
        500,
        `${sinInvitados}. No se creó el evento.` +
          (errorAlDeshacer
            ? ` Ojo: quedó una fila a medias (${eventoId}) que no se pudo sacar: ${errorAlDeshacer.message}`
            : "")
      );
    }
  }

  // ── Google ────────────────────────────────────────────────────────────────
  const enGoogle = await escribirEnGoogle(
    "crear",
    { casilla: dueno.casilla, google_event_id: actual?.google_event_id ?? null, inicio, fin, ot_id: ordenId },
    eventoParaGoogle(fila, invitados, dueno.casilla)
  );

  // **Lo que Google devolvió, no lo que se mandó** (`columnasDespuesDeEscribir`):
  // es lo único que separa el eco de una escritura propia de un cambio hecho por
  // una persona. Si se anotara lo enviado, cada sincronización que mueva la OT
  // sonaría como divergencia en cinco teléfonos.
  const columnas = columnasDespuesDeEscribir(enGoogle, marca);
  if (actual?.divergencia && !enGoogle.pendiente) {
    Object.assign(columnas, parDivergencia(null, marca));
    advertencias.push(
      `Este evento ${actual.divergencia === "borrado" ? "lo habían borrado" : "lo habían movido"} desde ` +
        `Google: se volvió a escribir como dice la orden y la divergencia quedó resuelta.`
    );
  }
  const errorAlAnotar = await anotarEnLaFila(admin, eventoId, columnas);

  // Con el evento divergido, el fallo deja `divergencia` y `google_pendiente` a la
  // vez, y el cron no levanta eso: el cartel de siempre («se reintenta») mentiría.
  const dePendiente =
    actual?.divergencia && enGoogle.pendiente
      ? advertenciaDeReenviarDivergido(enGoogle.pendiente)
      : advertenciaDeLaEscritura(enGoogle, "El evento");
  if (dePendiente) advertencias.push(dePendiente);
  if (errorAlAnotar) {
    advertencias.push(
      `No se pudo anotar en el evento lo que pasó con Google, ni en dos intentos (${errorAlAnotar}). ` +
        // El evento de una OT es de sólo lectura en la Agenda: «volvé a guardar
        // el evento» llevaría a un 409. Se vuelve a mandar la orden.
        (enGoogle.pendiente
          ? "El evento sigue sin estar en Google."
          : "Si Google ya tiene el cambio, el SdG puede avisar de un movimiento que no es real: volvé a mandar la orden.")
    );
  }

  return {
    ok: true,
    eventoId,
    reemplazo: Boolean(actual),
    inicio,
    enGoogle: !enGoogle.pendiente,
    pendiente: enGoogle.pendiente ?? null,
    advertencias,
  };
}

/** Deja los invitados del evento como `nuevos`, tocando sólo la diferencia. Devuelve el error, o `null`. */
async function cambiarInvitados(
  admin: SupabaseClient,
  eventoId: string,
  actuales: string[],
  nuevos: string[]
): Promise<string | null> {
  const { sacar, agregar } = diferenciaDeInvitados(actuales, nuevos);
  // Primero los que se suman: si falla un insert, nadie quedó afuera.
  return (await agregarInvitados(admin, eventoId, agregar)) ?? (await sacarInvitados(admin, eventoId, sacar));
}
