import type { SupabaseClient } from "@supabase/supabase-js";
import { diaDeLaSemana, sumarDias } from "@/lib/core/fechas";
import { enviarPush, type Aviso } from "@/lib/core/webpush";
import { esHoraDeAvisar, type ResultadoDelAviso } from "@/lib/core/avisoAlInstante";
import { nivelEnModulo } from "@/lib/core/access";
import { traerTodo } from "@/lib/core/paginado";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import { fechaParaElCalendario } from "@/lib/agenda/evento";
import { ESTADOS_CERRADOS, estaAtrasada } from "./alertas";

/**
 * Qué órdenes nombra cada corrida del recordatorio de Mantenimiento, y cómo se
 * escribe el aviso. Todo puro: no lee la base, no manda nada y no sabe qué día
 * es —`hoy` entra como parámetro—. La ruta del cron lee, llama y envía.
 *
 * ── EL DOMINGO NO SALE, Y ESO MUEVE LOS DÍAS QUE SE MIRAN ─────────────────────
 *
 * El push no se manda los domingos (pedido), pero sí los sábados. Con la regla
 * «ayer» y «pasado mañana» a secas, saltar el domingo dejaría días huérfanos:
 *
 *  - Lo que cruzó en domingo se miraría el lunes de ayer... que es domingo, y
 *    nadie lo mira. Por eso **el lunes recoge sábado y domingo** (hacia atrás).
 *  - Lo que arranca el martes se miraría el domingo, dos días antes, y el
 *    domingo no corre. Por eso **el sábado adelanta**: mira lunes y martes
 *    (hacia adelante). Ese aviso sale tres días antes en vez de dos, y es
 *    aceptable; uno que no sale nunca, no.
 *
 * El test «ningún día queda sin cubrir» prueba que cada día del mes es mirado
 * por las dos puntas exactamente una vez: ni huérfano ni repetido.
 */

/** Hasta dónde entra la descripción de una orden antes de recortarse. */
const LARGO_DE_LA_DESCRIPCION = 60;

/** Cuántas órdenes se nombran antes de resumir el resto. Igual que los demás resúmenes. */
const CUANTAS_SE_NOMBRAN = 3;

/**
 * A dónde lleva el aviso de las atrasadas. Es el mismo literal que el `href` de
 * `lib/home/avisos.ts`, escrito a propósito en los dos lugares: ese archivo
 * tiene todos sus href inline, y una constante importada para uno solo rompería
 * ese patrón. Si cambia acá, cambia allá.
 */
export const URL_ATRASADAS = "/mantenimiento/ordenes?atrasada=1";

/** A dónde lleva el aviso de las que arrancan: el listado, sin filtro. */
export const URL_LISTADO = "/mantenimiento/ordenes";

/** Lo que hace falta de una orden para decidir si se nombra y para nombrarla. */
export interface OrdenParaRecordar {
  ot_number: number;
  estado: string | null;
  fecha_ejecucion: string | null;
  fecha_ejecucion_pendiente: string | null;
  fecha_fin: string | null;
  sector_raw: string | null;
  descripcion: string | null;
}

/** Qué días de inicio cuentan como «se atrasó» en la corrida de `hoy`. */
export function diasQueCruzaron(hoy: string): string[] {
  // El lunes la corrida anterior fue el sábado: faltan el sábado y el domingo.
  if (diaDeLaSemana(hoy) === 1) return [sumarDias(hoy, -2), sumarDias(hoy, -1)];
  return [sumarDias(hoy, -1)];
}

/** Qué días de inicio cuentan como «arranca en dos días» en la corrida de `hoy`. */
export function diasQueArrancan(hoy: string): string[] {
  // El sábado adelanta el aviso del martes, que le tocaría al domingo.
  if (diaDeLaSemana(hoy) === 6) return [sumarDias(hoy, 2), sumarDias(hoy, 3)];
  return [sumarDias(hoy, 2)];
}

/** El día en que la orden arranca para el calendario, recortado a `aaaa-mm-dd`. */
function inicioEfectivo(orden: OrdenParaRecordar): string {
  const inicio = fechaParaElCalendario({
    fecha_ejecucion: orden.fecha_ejecucion,
    fecha_ejecucion_pendiente: orden.fecha_ejecucion_pendiente,
  });
  return (inicio ?? "").slice(0, 10);
}

/** El día en que la orden vence: su fin, o el inicio si la ventana es de un día. */
function finEfectivo(orden: OrdenParaRecordar): string {
  const inicio = inicioEfectivo(orden);
  const fin = String(orden.fecha_fin ?? "").slice(0, 10);
  return fin && fin > inicio ? fin : inicio;
}

/**
 * Las que vencieron el día que cruzó, y siguen abiertas.
 *
 * **Se cruza el fin de la ventana y no el inicio**, porque `estaAtrasada` vence
 * por el fin. Cruzar el inicio fue el error que estuvo acá: en una orden de
 * varios días las dos condiciones nunca son verdaderas el mismo día —el día
 * `inicio+1` todavía no está atrasada y el día `fin+1` ya no tiene su inicio en
 * los días que cruzaron—, así que no se anunciaba nunca. Para las de un solo
 * día el fin efectivo es el inicio y nada cambia.
 */
export function lasQueSeAtrasaron(ordenes: OrdenParaRecordar[], hoy: string): OrdenParaRecordar[] {
  const dias = diasQueCruzaron(hoy);
  return ordenes.filter((o) => estaAtrasada(o, hoy) && dias.includes(finEfectivo(o)));
}

/**
 * Las abiertas que todavía no están atrasadas y arrancan el día que toca.
 * «No atrasada» no alcanza para decir «abierta»: una realizada o cancelada con
 * fecha futura tampoco lo está, y no hay que recordarla.
 */
export function lasQueArrancan(ordenes: OrdenParaRecordar[], hoy: string): OrdenParaRecordar[] {
  const dias = diasQueArrancan(hoy);
  return ordenes.filter(
    (o) =>
      !ESTADOS_CERRADOS.includes(String(o.estado ?? "").toUpperCase()) &&
      !estaAtrasada(o, hoy) &&
      dias.includes(inicioEfectivo(o))
  );
}

const limpio = (t: string | null) => (t ?? "").trim();

function recortar(t: string): string {
  return t.length > LARGO_DE_LA_DESCRIPCION ? `${t.slice(0, LARGO_DE_LA_DESCRIPCION)}…` : t;
}

/** Con una sola orden: número, sector y qué es, lo que deja decidir si hay que entrar. */
function nombreEntero(o: OrdenParaRecordar): string {
  const sector = limpio(o.sector_raw);
  const descripcion = limpio(o.descripcion);
  return (
    `OT ${o.ot_number}` +
    (sector ? ` · ${sector}` : "") +
    (descripcion ? ` — ${recortar(descripcion)}` : "")
  );
}

/** Con varias: número y sector, que es lo que cabe en tres nombres. */
function nombreCorto(o: OrdenParaRecordar): string {
  const sector = limpio(o.sector_raw);
  return `OT ${o.ot_number}` + (sector ? ` (${sector})` : "");
}

function cuerpoDeVarias(ordenes: OrdenParaRecordar[]): string {
  const nombradas = ordenes.slice(0, CUANTAS_SE_NOMBRAN).map(nombreCorto);
  const restantes = ordenes.length - nombradas.length;
  return restantes > 0
    ? `${nombradas.join(", ")} y ${restantes} más`
    : `${nombradas.slice(0, -1).join(", ")} y ${nombradas[nombradas.length - 1]}`;
}

/** El aviso de las que se atrasaron. `null` si no hay ninguna: no se manda un push para decir que no pasa nada. */
export function textoDeLasAtrasadas(ordenes: OrdenParaRecordar[]): Aviso | null {
  if (ordenes.length === 0) return null;
  if (ordenes.length === 1) {
    return { title: "Se atrasó una orden de trabajo", body: nombreEntero(ordenes[0]), url: URL_ATRASADAS };
  }
  return {
    title: `${ordenes.length} órdenes de trabajo se atrasaron`,
    body: cuerpoDeVarias(ordenes),
    url: URL_ATRASADAS,
  };
}

/**
 * El aviso de las que arrancan. `null` si no hay ninguna.
 *
 * El título dice «en dos días» salvo el sábado, cuando la corrida nombra
 * también las del martes, que están a tres: ahí dice «en los próximos días».
 * Un título que afirma dos cuando son tres enseña a no leer el siguiente.
 */
export function textoDeLasQueArrancan(ordenes: OrdenParaRecordar[], hoy: string): Aviso | null {
  if (ordenes.length === 0) return null;
  const cuando = diasQueArrancan(hoy).length > 1 ? "en los próximos días" : "en dos días";
  if (ordenes.length === 1) {
    return { title: `Una orden de trabajo arranca ${cuando}`, body: nombreEntero(ordenes[0]), url: URL_LISTADO };
  }
  return {
    title: `${ordenes.length} órdenes de trabajo arrancan ${cuando}`,
    body: cuerpoDeVarias(ordenes),
    url: URL_LISTADO,
  };
}

/**
 * Quiénes reciben: los activos con nivel `admin` efectivo en Mantenimiento.
 *
 * Sale de `nivelEnModulo()` y no del grant a secas: le da `admin` a todo
 * `admin_sistema` aunque su grant explícito diga `lectura`, que es lo correcto
 * acá —puede reprogramar igual—, y deja afuera a un encargado con `lectura`.
 */
export function quienesAdministran(
  usuarios: { id: string; rol: Rol; activo: boolean }[],
  grants: UsuarioModulo[]
): Set<string> {
  const ids = new Set<string>();
  for (const u of usuarios) {
    if (!u.activo) continue;
    const suyos = grants.filter((g) => g.usuario_id === u.id);
    if (nivelEnModulo(u.rol, suyos, "mantenimiento") === "admin") ids.add(u.id);
  }
  return ids;
}

/**
 * Manda los dos avisos de la corrida: las OT que se atrasaron y las que
 * arrancan. Un push por aparato y por aviso, a los que administran
 * Mantenimiento.
 *
 * ── POR QUÉ ESTO NO PASA POR `avisarAQuienDecide()` ──────────────────────────
 *
 * Es la misma excepción que `lib/agenda/avisoDeDivergencia.ts`: de las tres
 * condiciones del portón de `lib/core/avisoAlInstante.ts` cumple la 1 (hay
 * gente nombrada: quienes administran el módulo) y la 3 (acaba de pasar o está
 * por pasar), y **no cumple la 2**: nada se frena hasta que alguien reprograme.
 * Se manda porque se pidió, y es un precedente y no un permiso.
 *
 * ── EL NÚMERO INCÓMODO ───────────────────────────────────────────────────────
 *
 * Medido el 19/11/2026, de las cinco personas que administran Mantenimiento
 * **sólo dos tienen una suscripción push, y son los dos `admin_sistema`**. El
 * pedido fue push y no correo sabiendo eso: las otras tres no se enteran por
 * acá hasta que prendan las notificaciones en Mi cuenta.
 *
 * El orden es el que no cuesta nada cuando no hay nada que hacer: la hora, las
 * órdenes, y recién ahí la gente. Fuera de 7:00–21:00 no se manda ni se encola.
 * **Nunca tira**: un push service caído no puede hacer fallar un cron.
 */
export async function avisarDeLasOT(
  admin: SupabaseClient,
  hoy: string,
  /** Sólo para los tests. En producción se llama sin nada. */
  ahora?: Date
): Promise<ResultadoDelAviso & { atrasadas: number; proximas: number; error?: string }> {
  const vacio = { enviadas: 0, personas: 0, atrasadas: 0, proximas: 0 };
  if (!esHoraDeAvisar(ahora)) return { ...vacio, motivo: "fuera de hora" };

  // Fuera del `try` para que el `catch` informe lo que ya salió: un fallo tardío
  // (el `delete` de una suscripción vencida) no desmanda los pushes enviados.
  let enviadas = 0;
  const alcanzados = new Set<string>();
  let cuenta = { atrasadas: 0, proximas: 0 };

  try {
    const ordenes = await traerTodo<OrdenParaRecordar>((desde, hasta) =>
      admin
        .from("ordenes_trabajo")
        .select("ot_number, estado, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_fin, sector_raw, descripcion")
        // Sin orden explícito las páginas no son una partición estable: la
        // sincronización escribe esta tabla cada diez minutos y una fila movida
        // entre dos páginas se saltearía. Acá una OT salteada no se anuncia nunca.
        // Además fija cuáles tres nombra `cuerpoDeVarias`.
        .order("ot_number", { ascending: true })
        .range(desde, hasta)
    );
    const atrasadas = lasQueSeAtrasaron(ordenes, hoy);
    const proximas = lasQueArrancan(ordenes, hoy);
    cuenta = { atrasadas: atrasadas.length, proximas: proximas.length };
    const avisos = [textoDeLasAtrasadas(atrasadas), textoDeLasQueArrancan(proximas, hoy)].filter(
      (a): a is Aviso => a !== null
    );
    if (avisos.length === 0) return { ...vacio, ...cuenta, motivo: "nada que avisar" };

    const [leerUsuarios, leerGrants] = await Promise.all([
      admin.from("usuarios").select("id, rol, activo"),
      admin.from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("modulo", "mantenimiento"),
    ]);
    if (leerUsuarios.error) throw new Error(leerUsuarios.error.message);
    if (leerGrants.error) throw new Error(leerGrants.error.message);
    const destinatarios = quienesAdministran(
      (leerUsuarios.data ?? []) as { id: string; rol: Rol; activo: boolean }[],
      (leerGrants.data ?? []) as UsuarioModulo[]
    );
    if (destinatarios.size === 0) return { ...vacio, ...cuenta, motivo: "sin destinatarios" };

    const suscripciones = await traerTodo<{
      usuario_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>((desde, hasta) =>
      admin.from("push_suscripciones").select("usuario_id, endpoint, p256dh, auth").range(desde, hasta)
    );

    for (const aparato of suscripciones) {
      if (!destinatarios.has(aparato.usuario_id)) continue;
      for (const aviso of avisos) {
        const resultado = await enviarPush(aparato, aviso);
        if (resultado === "enviada") {
          enviadas++;
          alcanzados.add(aparato.usuario_id);
        } else if (resultado === "vencida") {
          // Ese aparato ya no existe: se borra esa fila y no las otras de la misma persona.
          await admin
            .from("push_suscripciones")
            .delete()
            .eq("usuario_id", aparato.usuario_id)
            .eq("endpoint", aparato.endpoint);
          break;
        }
      }
    }
    return { enviadas, personas: alcanzados.size, ...cuenta };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error("mantenimiento: no se pudo avisar de las OT:", motivo);
    // `error` aparte de `motivo`: «fuera de hora» es una decisión y esto es un
    // fallo, y quien llama (la ruta, que contesta 503) tiene que poder
    // distinguirlos sin comparar frases.
    return { ...vacio, ...cuenta, enviadas, personas: alcanzados.size, motivo, error: motivo };
  }
}
