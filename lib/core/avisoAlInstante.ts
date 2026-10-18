import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPush, type Aviso } from "@/lib/core/webpush";
import { horaEnArgentina } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";

/**
 * El aviso que interrumpe: un push en el momento, y no en el resumen de las
 * 8:30.
 *
 * ── QUÉ MERECE INTERRUMPIR A ALGUIEN ─────────────────────────────────────────
 *
 * El resumen diario existe porque avisar de cada cosa son diez pushes a la
 * mañana, la persona los silencia, y a partir de ahí el sistema no avisa más
 * nada —el porqué completo está en el encabezado de
 * `app/api/cron/avisos-diarios/route.ts`, y sigue valiendo—. Esto es la
 * excepción, así que el portón tiene que estar acá escrito y no en la cabeza de
 * nadie.
 *
 * Un evento merece interrumpir si cumple **las tres**:
 *
 *   1. Hay una **persona nombrada** esperando: una lista concreta de usuarios
 *      —`compras_aprobadores`, `os_aprobadores`—, no "el módulo" ni "alguien
 *      del sector". Si no se puede decir a quién avisarle, es un cartel.
 *   2. **Nada avanza hasta que decida.** No es "miralo hoy": es "hasta que vos
 *      no digas, esto está parado".
 *   3. **Acaba de pasar.** El evento es la aparición. Un estado que lleva tres
 *      días igual no es noticia a ninguna hora, y ése es el trabajo del resumen.
 *
 * Hoy las cumplen dos cosas y nada más: un requerimiento de compra que nace
 * esperando aprobación, y una orden de servicio que nace esperando aprobación.
 *
 * Los que NO pasan, para poder decirle que no al próximo:
 *
 *   - los avisos de ritmo ("hace 36 días que no se carga"): no hay nadie
 *     esperando, y su `cantidad` cuenta umbrales, no cosas;
 *   - `sheets_pendiente`: lo reintenta la próxima sincronización sola, y avisar
 *     de lo que se arregla solo es enseñar a ignorar los avisos;
 *   - las OT atrasadas: es un estado, no un evento;
 *   - las facturas del buzón sin vincular y las ausencias sin clasificar: son
 *     cola de trabajo de una persona sobre su módulo, no una decisión que
 *     destraba a otro.
 *
 * **Agregar un aviso a `lib/home/avisos.ts` no lo vuelve instantáneo.** Eso se
 * decide acá, a mano, y pasando las tres condiciones.
 *
 * ── UNA POR CORRIDA, NO UNA POR ÍTEM ─────────────────────────────────────────
 *
 * Es la regla que hace que esto no repita el problema que la fase 2 decidió no
 * tener. Medido contra producción el 18/10/2026, sobre `compras_sincronizaciones`
 * de 27 días: **42 corridas trajeron filas nuevas** (~1,5 por día), con
 * **mediana 2, promedio 3,7 y máximo 16** por corrida. Una notificación por
 * ítem son picos de dieciséis juntas; una por corrida es una interrupción y
 * media por día, que es algo que una persona sostiene.
 *
 * El freno contra una pegada de doscientas filas en la planilla sale gratis de
 * esto: siguen siendo un push. Está fijado con un test.
 *
 * ── LA VENTANA HORARIA NO ENCOLA NADA ────────────────────────────────────────
 *
 * Fuera de 7:00–21:00 no se manda, y tampoco se guarda para después. El
 * repesque ya existe y no hay que escribirlo: el resumen de las 8:30 cuenta los
 * `PENDIENTE` sin mirar cuándo entraron. Una cola de pendientes nocturnos sería
 * una tabla nueva para un caso que en 27 días pasó una vez.
 *
 * ── POR QUÉ NO HAY TABLA ─────────────────────────────────────────────────────
 *
 * No hace falta recordar qué se avisó: se anuncia **sólo lo que esta corrida
 * insertó**, así que la corrida siguiente ve esas filas como existentes y no
 * las vuelve a nombrar. La idempotencia sale de la forma del problema.
 *
 * El riesgo asumido es que si el envío falla, esos ítems no se reanuncian al
 * instante nunca más — los levanta el resumen de las 8:30. La alternativa es
 * una tabla de cola y un reintento para recuperar una notificación cuyo valor
 * es, justamente, ser inmediata.
 *
 * El diseño completo, con las mediciones: `docs/superpowers/specs/2026-10-18-avisos-al-instante-design.md`.
 */

/** La primera hora de Argentina en la que se puede molestar a alguien. */
const DESDE = 7;
/** La primera hora en la que ya no. Exclusiva: a las 21:00 en punto no se manda. */
const HASTA = 21;

/** Cuántos ítems se nombran antes de resumir el resto. Igual que el resumen diario. */
const CUANTOS_SE_NOMBRAN = 3;

/** Hasta dónde entra la descripción en el cuerpo antes de recortarse. */
const LARGO_DE_LA_DESCRIPCION = 60;

/** Una cosa que quedó esperando la decisión de alguien. */
export interface ItemQueEspera {
  /** Cómo se la nombra: "RI 1842", "OS 231". */
  etiqueta: string;
  /** Qué se pidió. Se usa sólo cuando hay un ítem solo: con varios no entra. */
  descripcion: string | null;
}

/** Cómo se llama en la frase lo que espera. */
export interface NombreDeLoQueEspera {
  /** Con mayúscula y artículo, porque abre el título: "Un pedido". */
  singular: string;
  /** Sin número, que se antepone: "pedidos". */
  plural: string;
}

/** De qué lista salen los que pueden decidir. Son dos tablas distintas a propósito. */
export type ListaDeAprobadores = "compras_aprobadores" | "os_aprobadores";

export interface ResultadoDelAviso {
  enviadas: number;
  personas: number;
  /** Por qué no se mandó, cuando no se mandó. Va al log y a la respuesta del sync. */
  motivo?: string;
}

/**
 * Si estamos dentro de la franja en la que se puede interrumpir.
 *
 * La hora sale de `horaEnArgentina` y no de los getters del runtime: Vercel
 * corre en UTC y el cron de Compras es a las 09:00 UTC, o sea las 6 de la
 * mañana de acá. Mandar a esa hora —o peor, a las 3— es cómo se pierde el
 * permiso de notificar.
 */
export function esHoraDeAvisar(instante: Date = new Date()): boolean {
  const hora = horaEnArgentina(instante);
  return hora >= DESDE && hora < HASTA;
}

/** El texto de la descripción recortado, o `null` si no dice nada. */
function loQuePidio(descripcion: string | null): string | null {
  const limpia = (descripcion ?? "").trim();
  if (!limpia) return null;
  return limpia.length > LARGO_DE_LA_DESCRIPCION
    ? `${limpia.slice(0, LARGO_DE_LA_DESCRIPCION)}…`
    : limpia;
}

/**
 * Los ítems de una corrida convertidos en **una** notificación.
 *
 * Devuelve `null` cuando no hay nada: no se manda una notificación para decir
 * que no pasa nada. Ésa es la que enseña a ignorarlas.
 *
 * Con uno solo se nombra el ítem y lo que pidió, porque es lo que deja decidir
 * sin abrir nada. Con varios no entra ninguna descripción y lo útil es cuántos
 * son.
 */
export function textoDeLaInterrupcion(
  items: ItemQueEspera[],
  nombre: NombreDeLoQueEspera,
  url: string
): Aviso | null {
  if (items.length === 0) return null;

  if (items.length === 1) {
    const pidio = loQuePidio(items[0].descripcion);
    return {
      title: `${nombre.singular} espera tu aprobación`,
      body: pidio ? `${items[0].etiqueta} · ${pidio}` : items[0].etiqueta,
      url,
    };
  }

  const nombrados = items.slice(0, CUANTOS_SE_NOMBRAN).map((i) => i.etiqueta);
  const restantes = items.length - nombrados.length;
  const cuerpo =
    restantes > 0
      ? `${nombrados.join(", ")} y ${restantes} más`
      : // "a, b y c": la última va con "y", que es como se lee una lista.
        `${nombrados.slice(0, -1).join(", ")} y ${nombrados[nombrados.length - 1]}`;

  return {
    title: `${items.length} ${nombre.plural} esperan tu aprobación`,
    body: cuerpo,
    url,
  };
}

/**
 * A qué aparatos hay que mandar.
 *
 * Son aparatos y no personas porque la clave de `push_suscripciones` es
 * `(usuario_id, endpoint)`: el celular y la computadora son dos filas, y las
 * dos tienen que sonar.
 *
 * `excepto` es quien cargó el pedido. Avisarle a alguien de algo que acaba de
 * hacer él es la clase de notificación que enseña a ignorarlas, y pasa seguido:
 * de los cuatro que aprueban compras, varios también piden.
 */
export function aparatosAAvisar<T extends { usuario_id: string }>(
  suscripciones: T[],
  puedenDecidir: Set<string>,
  excepto: string | null
): T[] {
  return suscripciones.filter(
    (s) => puedenDecidir.has(s.usuario_id) && s.usuario_id !== excepto
  );
}

/**
 * Manda la notificación a quien puede decidir sobre estos ítems.
 *
 * **Nunca tira.** Lo llaman una sincronización y una ruta de alta, y las dos ya
 * guardaron lo suyo cuando llegan acá: si el push service está caído, la compra
 * igual quedó pedida y la corrida igual terminó bien. Un fallo de envío no es
 * un fallo de la acción que lo disparó, así que todo el cuerpo va adentro de un
 * `try` que devuelve el motivo en vez de relanzarlo.
 *
 * El orden de las comprobaciones es el que hace que no cueste nada cuando no
 * hay nada que hacer: primero los ítems, después la hora, y recién ahí se toca
 * la base. La mayoría de las corridas no traen filas nuevas.
 */
export async function avisarAQuienDecide(
  admin: SupabaseClient,
  opciones: {
    lista: ListaDeAprobadores;
    items: ItemQueEspera[];
    nombre: NombreDeLoQueEspera;
    url: string;
    /** Quien lo cargó: no se le avisa de lo que acaba de hacer. */
    excepto?: string | null;
    /** Sólo para los tests. En producción se llama sin nada. */
    ahora?: Date;
  }
): Promise<ResultadoDelAviso> {
  const { lista, items, nombre, url, excepto = null, ahora } = opciones;

  if (items.length === 0) return { enviadas: 0, personas: 0, motivo: "nada que avisar" };
  if (!esHoraDeAvisar(ahora)) return { enviadas: 0, personas: 0, motivo: "fuera de hora" };

  const aviso = textoDeLaInterrupcion(items, nombre, url);
  if (!aviso) return { enviadas: 0, personas: 0, motivo: "nada que avisar" };

  try {
    const { data: aprobadores, error: errorLista } = await admin
      .from(lista)
      .select("usuario_id");
    if (errorLista) throw new Error(errorLista.message);

    const puedenDecidir = new Set((aprobadores ?? []).map((a) => a.usuario_id as string));
    if (puedenDecidir.size === 0) return { enviadas: 0, personas: 0, motivo: "nadie aprueba" };

    // Paginado aunque hoy haya una sola fila: PostgREST corta en 1000 y no
    // avisa, y esta tabla crece con cada aparato de cada persona.
    const suscripciones = await traerTodo<{
      usuario_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>((desde, hasta) =>
      admin.from("push_suscripciones").select("usuario_id, endpoint, p256dh, auth").range(desde, hasta)
    );

    const candidatos = aparatosAAvisar(suscripciones, puedenDecidir, excepto);
    if (candidatos.length === 0) return { enviadas: 0, personas: 0, motivo: "nadie suscripto" };

    // Una cuenta dada de baja no recibe. Sus suscripciones siguen vivas hasta
    // que se borre la fila de `usuarios`, así que desactivar a alguien no las
    // limpia — mismo cuidado que el cron del resumen.
    const { data: activos, error: errorUsuarios } = await admin
      .from("usuarios")
      .select("id")
      .eq("activo", true)
      .in("id", [...new Set(candidatos.map((c) => c.usuario_id))]);
    if (errorUsuarios) throw new Error(errorUsuarios.message);

    const estaActivo = new Set((activos ?? []).map((u) => u.id as string));
    const aparatos = candidatos.filter((c) => estaActivo.has(c.usuario_id));
    if (aparatos.length === 0) return { enviadas: 0, personas: 0, motivo: "nadie activo" };

    let enviadas = 0;
    for (const aparato of aparatos) {
      const resultado = await enviarPush(aparato, aviso);
      if (resultado === "enviada") enviadas++;
      else if (resultado === "vencida") {
        // El push service dice que ese aparato ya no existe. Se borra esa fila
        // y no las otras de la misma persona: se desinstaló la app de un
        // teléfono, no se dio de baja de todo.
        await admin
          .from("push_suscripciones")
          .delete()
          .eq("usuario_id", aparato.usuario_id)
          .eq("endpoint", aparato.endpoint);
      }
    }

    return { enviadas, personas: new Set(aparatos.map((a) => a.usuario_id)).size };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error("aviso al instante: no se pudo avisar", motivo);
    return { enviadas: 0, personas: 0, motivo };
  }
}
